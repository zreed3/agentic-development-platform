// Shared, fail-soft reads for the ADG context-discipline hooks. All functions swallow errors
// and return null/[]: these hooks are additive context injectors, never blockers, so a missing
// DB, missing sqlite3, or unreadable file must degrade to "inject nothing", never throw.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function dbPath(cwd) {
  return path.join(cwd, "data/backlog.sqlite");
}

// The single in-progress/claimed item the agent is working, or null.
export function queryActiveItem(cwd) {
  try {
    const db = dbPath(cwd);
    if (!fs.existsSync(db)) return null;
    const sql =
      "select id, title, current_status as status, coalesce(write_scope_json,'') as ws " +
      "from backlog_item_current_status " +
      "where current_status in ('in-progress','in_progress','claimed','started','blocked') " +
      "order by latest_update_at desc limit 1";
    const out = execFileSync("sqlite3", [db, "-json", sql], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const rows = JSON.parse(out || "[]");
    if (!Array.isArray(rows) || !rows.length) return null;
    const r = rows[0];
    let writeScope = "";
    try {
      const parsed = r.ws ? JSON.parse(r.ws) : null;
      if (Array.isArray(parsed)) writeScope = parsed.join(", ");
    } catch {
      /* leave empty */
    }
    return { id: r.id, title: r.title, status: r.status, writeScope };
  } catch {
    return null;
  }
}

// The tamper-evident audit chain tip hash, or null.
export function readAuditTip(cwd) {
  try {
    const file = path.join(cwd, "data/audit/audit-log.chain-state.json");
    const state = JSON.parse(fs.readFileSync(file, "utf8"));
    return state.tipHash || null;
  } catch {
    return null;
  }
}

// A one-line summary of the last appended audit event, or null. Reads only the final line
// (never bulk-loads the log).
export function readLastAudit(cwd) {
  try {
    const file = path.join(cwd, "data/audit/audit-log.jsonl");
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split("\n").filter((l) => l.trim());
    if (!lines.length) return null;
    const e = JSON.parse(lines[lines.length - 1]);
    const who = e.eventType || e.event_type || e.type || "event";
    const what = e.targetId || e.target_id || e.featureId || e.feature_id || "";
    const rawSum = e.summary ? String(e.summary) : "";
    const sum = rawSum ? `: ${rawSum.length > 100 ? `${rawSum.slice(0, 100)}…` : rawSum}` : "";
    return `${who}${what ? ` ${what}` : ""}${sum}`.trim();
  } catch {
    return null;
  }
}

// Whether a fix plan exists on disk (the durable plan the loop re-reads).
export function fixPlanPath(cwd) {
  for (const cand of ["fix_plan.md", "specs/fix_plan.md", "docs/fix_plan.md"]) {
    try {
      if (fs.existsSync(path.join(cwd, cand))) return cand;
    } catch {
      /* next */
    }
  }
  return null;
}
