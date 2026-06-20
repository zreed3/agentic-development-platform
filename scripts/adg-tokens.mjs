#!/usr/bin/env node
// Deterministic token / size measurement for ADG outputs.
//
// No model tokenizer is required (none is vendored). This produces a stable,
// reproducible estimate so before/after deltas are *measured*, not asserted.
// The same method is applied to both sides of a comparison, so the delta is a
// real measurement of the change even though the absolute count is an estimate.
//
//   node scripts/adg-tokens.mjs --file path                  -> measure a file
//   node scripts/adg-tokens.mjs --cmd "npm run guardrails:check" -> measure stdout
//   echo "..." | node scripts/adg-tokens.mjs --stdin         -> measure stdin
//   node scripts/adg-tokens.mjs --file a --file b --json      -> measure many, JSON out
//
// Estimate method (documented so it is auditable):
//   estTokens = number of BPE-ish atoms = runs of [word chars] | [digits] |
//   single punctuation | newline. This tracks real tokenizers far better than
//   chars/4 for structured/JSON output, and is fully deterministic.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

function abs(file) {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function parseArgs(argv) {
  const args = { files: [], cmds: [], flags: new Set() };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--file") args.files.push(argv[++i]);
    else if (token === "--cmd") args.cmds.push(argv[++i]);
    else if (token === "--label") args.label = argv[++i];
    else if (token.startsWith("--")) args.flags.add(token.slice(2));
  }
  return args;
}

// Deterministic token estimate: count BPE-ish atoms.
export function estimateTokens(text) {
  if (!text) return 0;
  const atoms = text.match(/[A-Za-z]+|[0-9]+|\s+|[^\sA-Za-z0-9]/gu) || [];
  let count = 0;
  for (const atom of atoms) {
    if (/^\s+$/u.test(atom)) {
      // Whitespace: count newlines and indentation runs, collapse spaces.
      count += (atom.match(/\n/gu) || []).length || (atom.length > 1 ? 1 : 0);
    } else if (/^[A-Za-z]+$/u.test(atom)) {
      // Word: ~1 token per 4 chars (BPE subword behaviour).
      count += Math.max(1, Math.ceil(atom.length / 4));
    } else {
      count += 1;
    }
  }
  return count;
}

export function measure(label, text) {
  return {
    label,
    bytes: Buffer.byteLength(text, "utf8"),
    chars: text.length,
    lines: text === "" ? 0 : text.split("\n").length,
    estTokens: estimateTokens(text),
  };
}

function readSource(args) {
  const results = [];
  for (const file of args.files) {
    const text = fs.readFileSync(abs(file), "utf8");
    results.push(measure(file, text));
  }
  for (const cmd of args.cmds) {
    const text = execSync(cmd, { cwd: root, encoding: "utf8", shell: "/bin/zsh", maxBuffer: 64 * 1024 * 1024 });
    results.push(measure(cmd, text));
  }
  if (args.flags.has("stdin")) {
    const text = fs.readFileSync(0, "utf8");
    results.push(measure(args.label || "stdin", text));
  }
  return results;
}

const args = parseArgs(process.argv.slice(2));
const results = readSource(args);
if (results.length === 0) {
  console.error("Provide --file <path>, --cmd <command>, or --stdin.");
  process.exit(1);
}

if (args.flags.has("json")) {
  console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
} else {
  for (const r of results) {
    console.log(`${r.estTokens}\ttokens\t${r.bytes}\tbytes\t${r.lines}\tlines\t${r.label}`);
  }
}
