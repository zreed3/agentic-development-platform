#!/usr/bin/env node
// Smoke test for the ADG governance MCP server. Connects a real MCP client over
// stdio, lists the tools, and exercises the two read-only tools. record_audit is
// intentionally NOT called so the test never appends to the real audit log.
//
// Run: npm run test:adg-mcp

import assert from "node:assert/strict";
import { execSync } from "node:child_process";
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
    assert.deepEqual(names, ["classify_work", "context_packet", "record_audit"], `unexpected tools: ${names.join(", ")}`);
    const readOnly = Object.fromEntries(tools.map((t) => [t.name, t.annotations?.readOnlyHint]));
    assert.equal(readOnly.classify_work, true, "classify_work must be read-only");
    assert.equal(readOnly.context_packet, true, "context_packet must be read-only");
    assert.equal(readOnly.record_audit, false, "record_audit is append-only, not read-only");
    ok("server exposes classify_work, context_packet, record_audit with correct read-only hints");

    // adg-work-classify emits a human-readable classification; MCP tool content is text.
    const classifyText = toolText(await client.callTool({ name: "classify_work", arguments: { intent: "add an evidence_tier column to the schema", file: "data/schema.sql" } }));
    assert.match(classifyText, /lane:\s*L[34]/, `schema work should be sensitive (L3/L4), got: ${classifyText}`);
    assert.match(classifyText, /audit:\s*true/, "schema work must require an audit");
    ok("classify_work returns the Proofline lane and gate for an intent");

    const packet = await client.callTool({ name: "context_packet", arguments: { feature: "S07", format: "json" } });
    const packetJson = JSON.parse(toolText(packet));
    assert.equal(packetJson.kind, "context-packet", "context_packet must return a context packet");
    ok("context_packet returns a bounded packet for a feature");

    // An unknown tool is reported as an error, not a crash.
    const bad = await client.callTool({ name: "nope", arguments: {} });
    assert.equal(bad.isError, true, "an unknown tool must return isError");
    ok("an unknown tool call is reported as an error");

    console.log(`\nadg mcp server: ${passed} checks passed`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
