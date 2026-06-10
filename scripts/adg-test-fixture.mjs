#!/usr/bin/env node
// Shared test fixtures for generated ADG databases.

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const lockPath = path.join(root, "data/.backlog-setup.lock");

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function exec(command) {
  return execSync(command, { cwd: root, encoding: "utf8", shell: "/bin/zsh", maxBuffer: 8 * 1024 * 1024 }).trim();
}

function acquireLock() {
  const started = Date.now();
  while (true) {
    try {
      fs.mkdirSync(lockPath, { recursive: false });
      return;
    } catch (error) {
      if (Date.now() - started > 30000) throw new Error(`Timed out waiting for ${lockPath}`);
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > 60000) fs.rmSync(lockPath, { recursive: true, force: true });
      } catch {
        // The lock disappeared between checks.
      }
      sleep(100);
    }
  }
}

function demoBacklogReady() {
  try {
    const count = exec('sqlite3 data/backlog.sqlite "select count(*) from feature_current_status where feature_id = \'S07\';" 2>/dev/null');
    return count === "1";
  } catch {
    return false;
  }
}

function demoBacklog() {
  acquireLock();
  try {
    if (!demoBacklogReady()) {
      exec("node scripts/backlog-db.mjs setup --seed data/seed/backlog.demo.seed.json --with-audit > /dev/null");
    }
  } finally {
    fs.rmSync(lockPath, { recursive: true, force: true });
  }
}

const command = process.argv[2] ?? "help";
if (command === "demo-backlog") {
  demoBacklog();
} else {
  console.log("Usage: node scripts/adg-test-fixture.mjs demo-backlog");
  process.exit(command === "help" ? 0 : 1);
}
