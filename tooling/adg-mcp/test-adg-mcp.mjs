#!/usr/bin/env node
// Smoke test for the ADG governance MCP server. Connects a real MCP client over
// stdio, lists the tools, and exercises the two read-only tools. record_audit is
// only exercised on its secret-refusal path: that refusal fires in the server's
// run() BEFORE record-audit.mjs is spawned, so the append-only audit log is never
// written. The test asserts the log file size is byte-for-byte unchanged across the
// refused call, so it gains regression coverage without polluting the real log.
//
// Run: npm run test:adg-mcp

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The MCP server is the one OPTIONAL feature that uses a dependency. Keep the core
// gate dependency-tolerant: skip (pass) if the SDK is not installed.
let Client;
let StdioClientTransport;
try {
  ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
  ({ StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js"));
} catch {
  console.log("adg mcp server: skipped (@modelcontextprotocol/sdk not installed -- optional feature)");
  process.exit(0);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const serverPath = path.join(root, "scripts/adg-mcp-server.mjs");

// The canonical append-only audit log. The secret-refusal test asserts this file
// is unchanged across a refused record_audit, proving nothing was appended.
const auditLogPath = path.join(root, "data/audit/audit-log.jsonl");
const auditLogSize = () => (fs.existsSync(auditLogPath) ? fs.statSync(auditLogPath).size : 0);

let passed = 0;
const ok = (label) => {
  passed += 1;
  console.log(`  ok ${label}`);
};

function toolText(result) {
  return (result.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
}

async function main() {
  // context_packet needs the demo backlog loaded.
  execSync("node scripts/adg-test-fixture.mjs demo-backlog", { cwd: root, stdio: "ignore" });

  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath], cwd: root });
  const client = new Client({ name: "adg-mcp-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ["classify_work", "context_packet", "control_state", "record_audit"], `unexpected tools: ${names.join(", ")}`);
    const readOnly = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
    assert.equal(readOnly.classify_work, true, "classify_work must be read-only");
    assert.equal(readOnly.context_packet, true, "context_packet must be read-only");
    assert.equal(readOnly.control_state, true, "control_state must be read-only");
    assert.equal(readOnly.record_audit, false, "record_audit is append-only, not read-only");
    ok("server exposes classify_work, context_packet, control_state, record_audit with correct read-only hints");

    // control_state is read-only and reports the always-on floor + disabled controls.
    const controlState = await client.callTool({ name: "control_state", arguments: {} });
    assert.equal(controlState.structuredContent?.policyFound, true, "control_state must find the policy");
    assert.ok(controlState.structuredContent.mandatoryAlwaysOn.includes("destructiveDeny"), "always-on set must include destructiveDeny");
    assert.ok(controlState.structuredContent.controls.length >= 8, "control_state should report all controls");
    ok("control_state returns the read-only guardrail control state");

    // The JSON-returning tools declare an outputSchema (structured outputs contract).
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    assert.ok(byName.classify_work.outputSchema, "classify_work must declare an outputSchema");
    assert.ok(byName.record_audit.outputSchema, "record_audit must declare an outputSchema");
    ok("classify_work and record_audit declare outputSchemas");

    // classify_work returns typed structuredContent alongside a compact text summary.
    const classify = await client.callTool({ name: "classify_work", arguments: { intent: "add an evidence_tier column to the schema", file: "data/schema.sql" } });
    assert.match(classify.structuredContent?.laneId ?? "", /L[34]/, `schema work should be sensitive (L3/L4), got: ${JSON.stringify(classify.structuredContent)}`);
    assert.equal(classify.structuredContent?.auditRequired, true, "schema work must require an audit");
    assert.match(toolText(classify), /audit true/, "text summary should report the audit requirement");
    ok("classify_work returns typed structuredContent (lane + gate) for an intent");

    // context_packet defaults to TOON (the token-efficient format); JSON on request.
    const packetDefault = toolText(await client.callTool({ name: "context_packet", arguments: { feature: "S07" } }));
    assert.match(packetDefault, /context:/, "default packet should be TOON (token-efficient default)");
    assert.doesNotMatch(packetDefault, /^\s*\{/, "default packet must not be JSON");
    const packet = await client.callTool({ name: "context_packet", arguments: { feature: "S07", format: "json" } });
    const packetJson = JSON.parse(toolText(packet));
    assert.equal(packetJson.kind, "context-packet", "context_packet must return a context packet on format:json");
    ok("context_packet defaults to TOON and returns JSON on request");

    // An unknown tool is reported as an error, not a crash.
    const bad = await client.callTool({ name: "nope", arguments: {} });
    assert.equal(bad.isError, true, "an unknown tool must return isError");
    ok("an unknown tool call is reported as an error");

    // record_audit refuses to forward likely secret material into the append-only log
    // (LLM02 sensitive-information disclosure). The refusal fires in the server's run()
    // BEFORE record-audit.mjs is spawned, so nothing is appended -- we assert the audit
    // log is byte-for-byte unchanged across the refused call. This is the real boundary,
    // exercised end-to-end through the MCP client, with no pollution of the real log.
    const auditSizeBefore = auditLogSize();
    const syntheticSecret = `sk-${"x".repeat(24)}`; // matches SECRET_PATTERNS; not a real key
    const refused = await client.callTool({
      name: "record_audit",
      arguments: { summary: `accidentally leaked a key ${syntheticSecret}`, type: "comment" },
    });
    assert.equal(refused.isError, true, "record_audit must refuse a summary containing secret material");
    assert.match(toolText(refused), /refused/i, "the refusal message should say it refused the append");
    assert.equal(auditLogSize(), auditSizeBefore, "a refused record_audit must not append to the append-only audit log");
    ok("record_audit refuses secret material and appends nothing to the audit log");

    console.log(`\nadg mcp server: ${passed} checks passed`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
