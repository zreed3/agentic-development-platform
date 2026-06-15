#!/usr/bin/env node
// Tests for the assetLint quality gate. Proves: a clean asset passes; an edge-clipped
// asset and a blank asset hard-fail under effect:block; a disabled control skips green;
// onToolMissing decides behaviour when the Rust binary is absent (skip green vs block).
//
// The Rust pixel reader is the one optional piece. Like the MCP test, this SKIPS (pass)
// when the binary is not built, so ci:governance stays green on a host without Rust.
// Hermetic: temp policies via ADG_GUARDRAILS_PATH; never touches the real audit log.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const LINT = path.join(root, "scripts/asset-lint.mjs");
const FIX = path.join(root, "tooling/adg-as-code/fixtures");
const BIN = process.env.ADG_ASSET_LINT_BIN || path.join(root, "tools/adg-asset-lint/target/release/adg-asset-lint");

if (!fs.existsSync(BIN)) {
  console.log("adg-asset-lint: skipped (Rust binary not built -- run npm run asset:lint:build)");
  process.exit(0);
}
// Ensure the committed fixtures exist (regenerate deterministically if missing).
if (!fs.existsSync(path.join(FIX, "clean.png"))) {
  spawnSync(process.execPath, [path.join(FIX, "make-fixtures.mjs")], { cwd: root, stdio: "ignore" });
}

function run(files, env = {}) {
  const res = spawnSync(process.execPath, [LINT, ...files, "--quiet"], { cwd: root, encoding: "utf8", env: { ...process.env, ...env } });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "adg-asset-"));
function policyWith(mutate) {
  const p = JSON.parse(fs.readFileSync(path.join(root, "config/agentic/guardrails.json"), "utf8"));
  mutate(p.controls.definitions.assetLint);
  const file = path.join(tmp, `policy-${Math.abs(JSON.stringify(p).length)}.json`);
  fs.writeFileSync(file, JSON.stringify(p));
  return file;
}

let passed = 0;
const check = (label, cond) => { assert.ok(cond, label); passed += 1; };

const clean = path.join(FIX, "clean.png");
const clipped = path.join(FIX, "clipped.png");
const blank = path.join(FIX, "blank.png");

// 1. clean passes, clipped + blank fail (effect:block -> enforcing).
check("clean asset passes (exit 0)", run([clean]).code === 0);
const c = run([clipped]);
check("edge-clipped asset hard-fails (exit 1)", c.code === 1 && /edge clip/.test(c.out));
const b = run([blank]);
check("blank asset hard-fails (exit 1)", b.code === 1 && /blank guard/.test(b.out));

// 2. a disabled control skips green even on a clipped asset.
const disabled = policyWith((a) => { a.enabled = false; });
check("disabled assetLint skips green", run([clipped], { ADG_GUARDRAILS_PATH: disabled }).code === 0);

// 3. effect:warn (advisory) -> a clipped asset is reported but exits 0.
const advisory = policyWith((a) => { a.effect = "allow"; });
const adv = run([clipped], { ADG_GUARDRAILS_PATH: advisory });
check("advisory (non-block) effect reports a clip but exits 0", adv.code === 0 && /WARN|clip/.test(adv.out));

// 4. onToolMissing: binary absent + skip -> exit 0; + block -> exit 2.
check("missing binary + onToolMissing:skip exits 0", run([clean], { ADG_ASSET_LINT_BIN: "/nonexistent/adg-asset-lint" }).code === 0);
const blockPolicy = policyWith((a) => { a.config = { ...(a.config || {}), onToolMissing: "block" }; });
check("missing binary + onToolMissing:block fails closed (exit 2)", run([clean], { ADG_ASSET_LINT_BIN: "/nonexistent/adg-asset-lint", ADG_GUARDRAILS_PATH: blockPolicy }).code === 2);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`adg-asset-lint: ${passed}/${passed} quality-gate checks OK`);
