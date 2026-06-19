// Host-agnostic, fail-soft reads of ADG durable state for the SDK adapters. Mirrors the
// plugin hooks' reader but lives in @adg/core so the SDK never imports plugin files. All
// functions swallow errors and return null/[]/defaults.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export function queryActiveItem(cwd = process.cwd()) {
  try {
    const db = path.join(cwd, "data/backlog.sqlite");
    if (!fs.existsSync(db)) return null;
    const sql =
      "select id, title, current_status as status, coalesce(write_scope_json,'') as ws " +
      "from backlog_item_current_status " +
      "where current_status in ('in-progress','in_progress','claimed','started','blocked') " +
      "order by latest_update_at desc limit 1";
    const rows = JSON.parse(execFileSync("sqlite3", [db, "-json", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) || "[]");
    if (!Array.isArray(rows) || !rows.length) return null;
    const r = rows[0];
    let writeScope = "";
    try {
      const p = r.ws ? JSON.parse(r.ws) : null;
      if (Array.isArray(p)) writeScope = p.join(", ");
    } catch {
      /* empty */
    }
    return { id: r.id, title: r.title, status: r.status, writeScope };
  } catch {
    return null;
  }
}

export function readAuditTip(cwd = process.cwd()) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, "data/audit/audit-log.chain-state.json"), "utf8")).tipHash || null;
  } catch {
    return null;
  }
}

export function readLastAudit(cwd = process.cwd()) {
  try {
    const lines = fs.readFileSync(path.join(cwd, "data/audit/audit-log.jsonl"), "utf8").split("\n").filter((l) => l.trim());
    if (!lines.length) return null;
    const e = JSON.parse(lines[lines.length - 1]);
    const who = e.eventType || e.event_type || e.type || "event";
    const what = e.targetId || e.target_id || e.featureId || "";
    const sum = e.summary ? `: ${String(e.summary).slice(0, 100)}` : "";
    return `${who}${what ? ` ${what}` : ""}${sum}`.trim();
  } catch {
    return null;
  }
}

export function loadLoopBudget(cwd = process.cwd()) {
  const candidates = [path.join(cwd, "config/agentic/loop-budget.json")];
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const up of ["..", "../..", "../../..", "../../../.."]) candidates.push(path.join(here, up, "config/agentic/loop-budget.json"));
  } catch {
    /* ignore */
  }
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch {
      /* next */
    }
  }
  return { caps: { maxTurns: 60 }, releaseGate: { mode: "block" } };
}
