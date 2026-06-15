#!/usr/bin/env node
// ADG deterministic quality gate for committed image assets (control: assetLint).
//
// Why this is a gate and not a PreToolUse hook: the PreToolUse hook matches command
// and path patterns BEFORE a tool runs, so it can never see the bytes a conversion
// produces. Asset defects (a logo clipped by an overflowing resize, a blank/invisible
// export, a wrong format) are properties of the produced file, so they must be checked
// AFTER the write. This gate is the enforcement; the assetLint entry in
// config/agentic/guardrails.json is the policy declaration; the verify lane / adg:doctor
// / CI run it and record its result as evidence.
//
//   node scripts/asset-lint.mjs                  -> walk the configured dir
//   node scripts/asset-lint.mjs a.webp b.png     -> lint specific files
//   node scripts/asset-lint.mjs --staged         -> lint git-staged image files (pre-commit)
//   node scripts/asset-lint.mjs --quiet          -> one machine-readable summary line
//
// Pixel reading is done by a small Rust helper (tools/adg-asset-lint), which decodes
// the image and reports raw measurements; this script owns ALL policy: it loads the
// assetLint control, applies the thresholds, and decides pass/fail. If the Rust binary
// is not built, the control's onToolMissing setting decides (default "skip": the gate
// stays green so ADG still runs on a host without the Rust toolchain; set "block" for
// hard enforcement). Exit: 0 = pass/skipped, 1 = a checked asset failed (only when the
// control effect is deny/block), 2 = config or tooling error under a fail-closed policy.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const policyPath = process.env.ADG_GUARDRAILS_PATH || "config/agentic/guardrails.json";

const DEFAULTS = {
  dir: "public/images",
  allowedFormats: ["WEBP", "PNG", "SVG"],
  background: "white", // "white" | "transparent" | "#rrggbb"
  edgeStripPx: 2,
  edgeBackgroundMin: 0.999, // colour bg: min mean luminance of a clean edge strip
  edgeAlphaMax: 0.002, // transparent bg: max mean alpha of a clean edge strip
  meanLuminanceMin: 0.02, // reject all-dark
  meanLuminanceMax: 0.985, // reject all-white / blank-on-white
  onToolMissing: "skip", // "skip" (stay green) | "block" (fail-closed)
};

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  // Flags are boolean (--quiet, --staged) or --name=value. Bare tokens are file paths.
  const args = { files: [] };
  for (const tok of argv) {
    if (tok.startsWith("--")) {
      const [name, value] = tok.slice(2).split("=");
      args[name] = value === undefined ? true : value;
    } else {
      args.files.push(tok);
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const quiet = Boolean(args.quiet);

function emit(stream, payload, line) {
  stream.write(`${quiet ? line : JSON.stringify(payload, null, 2)}\n`);
}
function fail(code, payload, line) {
  emit(process.stderr, payload, line);
  process.exit(code);
}

// -- load the control from the single policy source --------------------------
let control;
try {
  const policy = JSON.parse(fs.readFileSync(abs(policyPath), "utf8"));
  control = policy?.controls?.definitions?.assetLint;
} catch (err) {
  fail(2, { policyPath, error: `cannot read policy: ${err && err.message}` }, `asset-lint: ERROR (policy unreadable)`);
}

if (!control) {
  emit(process.stdout, { policyPath, skipped: "assetLint control not declared" }, `asset-lint: skipped (control not declared)`);
  process.exit(0);
}
if (control.enabled === false) {
  emit(process.stdout, { policyPath, skipped: "assetLint disabled" }, `asset-lint: skipped (disabled)`);
  process.exit(0);
}

const cfg = { ...DEFAULTS, ...(control.config || {}) };
// deny/block -> enforce (nonzero on a failing asset); ask/allow/warn -> advisory.
const enforcing = ["deny", "block"].includes(control.effect);

// -- resolve the Rust pixel reader (fail-closed or skip per policy) ----------
const binPath = process.env.ADG_ASSET_LINT_BIN || "tools/adg-asset-lint/target/release/adg-asset-lint";
const binAbs = abs(binPath);
const haveBin = fs.existsSync(binAbs);
if (!haveBin) {
  if (cfg.onToolMissing === "skip") {
    emit(process.stdout, { skipped: "adg-asset-lint binary not built", binPath, hint: "npm run asset:lint:build" }, `asset-lint: skipped (binary not built; npm run asset:lint:build)`);
    process.exit(0);
  }
  // A quality gate that silently passes when it cannot run is the false-confidence
  // failure mode; under onToolMissing:"block" we fail closed.
  fail(2, { error: "adg-asset-lint binary not built", onToolMissing: cfg.onToolMissing, hint: "npm run asset:lint:build" }, `asset-lint: ERROR (binary not built; fail-closed)`);
}

// -- resolve the target file list --------------------------------------------
const ALLOWED_EXT = new Set([".webp", ".png", ".jpg", ".jpeg", ".svg"]);
function walk(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (ALLOWED_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}
function stagedImages() {
  try {
    const out = execFileSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACM"], { encoding: "utf8" });
    return out.split("\n").map((s) => s.trim()).filter(Boolean)
      .filter((f) => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
      .map((f) => abs(f)).filter((f) => fs.existsSync(f));
  } catch { return []; }
}

let files;
if (args.files.length) files = args.files.map(abs);
else if (args.staged) files = stagedImages();
else files = walk(abs(cfg.dir), []);

const rasterFiles = files.filter((f) => path.extname(f).toLowerCase() !== ".svg");
const svgFiles = files.filter((f) => path.extname(f).toLowerCase() === ".svg");

// -- run the Rust pixel reader once for all raster files ---------------------
function measureRaster(fileList) {
  if (fileList.length === 0) return [];
  const bgArg = cfg.background === "transparent" ? "transparent" : cfg.background;
  const out = execFileSync(binAbs, ["--background", bgArg, "--edge-strip", String(cfg.edgeStripPx), ...fileList], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  return JSON.parse(out);
}

const allowedUpper = cfg.allowedFormats.map((f) => f.toUpperCase());

function checkRaster(measurement) {
  const file = path.relative(root, measurement.file);
  if (measurement.error) return { file, failures: [`decode: ${measurement.error}`], ok: false };
  const failures = [];
  if (!allowedUpper.includes((measurement.format || "").toUpperCase())) {
    failures.push(`format ${measurement.format} not in ${cfg.allowedFormats.join("/")}`);
  }
  const mean = measurement.meanLuminance;
  if (!(mean >= cfg.meanLuminanceMin && mean <= cfg.meanLuminanceMax)) {
    failures.push(`blank guard: mean luminance ${mean.toFixed(4)} outside [${cfg.meanLuminanceMin}, ${cfg.meanLuminanceMax}]`);
  }
  for (const side of ["top", "bottom", "left", "right"]) {
    if (cfg.background === "transparent") {
      const a = measurement.edgeAlpha[side];
      if (a > cfg.edgeAlphaMax) failures.push(`edge clip: ${side} strip alpha ${a.toFixed(4)} > ${cfg.edgeAlphaMax} (content touches edge)`);
    } else {
      const m = measurement.edges[side];
      if (m < cfg.edgeBackgroundMin) failures.push(`edge clip: ${side} strip mean ${m.toFixed(4)} < ${cfg.edgeBackgroundMin} (content touches edge)`);
    }
  }
  return { file, format: measurement.format, dimensions: `${measurement.width}x${measurement.height}`, mean: Number(mean.toFixed(4)), edges: measurement.edges, failures, ok: failures.length === 0 };
}

function checkSvg(file) {
  const failures = [];
  if (!allowedUpper.includes("SVG")) failures.push("SVG not in allowedFormats");
  let bytes = 0;
  try { bytes = fs.statSync(file).size; } catch { /* ignore */ }
  if (bytes < 32) failures.push(`SVG too small (${bytes} bytes), likely empty`);
  return { file: path.relative(root, file), format: "SVG", dimensions: "vector", failures, ok: failures.length === 0 };
}

const results = [];
try {
  const measurements = measureRaster(rasterFiles);
  for (const m of measurements) results.push(checkRaster(m));
} catch (err) {
  fail(2, { error: `pixel reader failed: ${err && err.message}` }, `asset-lint: ERROR (pixel reader failed)`);
}
for (const f of svgFiles) {
  if (!fs.existsSync(f)) { results.push({ file: path.relative(root, f), failures: ["missing file"], ok: false }); continue; }
  results.push(checkSvg(f));
}

const failed = results.filter((r) => !r.ok);
const summary = {
  policyPath, control: "assetLint", effect: control.effect, enforcing,
  scanned: results.length, passed: results.length - failed.length, failed: failed.length,
};

if (failed.length === 0) {
  emit(process.stdout, { ...summary, results: quiet ? undefined : results }, `asset-lint: ok (${results.length} assets)`);
  process.exit(0);
}

const firstFail = `${failed[0].file}: ${failed[0].failures[0]}`;
emit(enforcing ? process.stderr : process.stdout,
  { ...summary, failures: failed.map((r) => ({ file: r.file, why: r.failures })) },
  `asset-lint: ${enforcing ? "FAIL" : "WARN"} (${failed.length}/${results.length} assets: ${firstFail})`);
process.exit(enforcing ? 1 : 0);
