#!/usr/bin/env node
// ADG governance MCP server (stdio).
//
// Exposes ADG's governance primitives to any MCP client, wrapping the existing
// scripts so there is one implementation, not two. Two tools are strictly
// read-only; the third is append-only (ADG's audit log is append-only by design --
// it never rewrites history):
//
//   classify_work   (read-only)   -> Proofline lane + risk + required gate for an intent/file
//   context_packet  (read-only)   -> bounded context packet for a feature/item (no side effects)
//   record_audit    (append-only) -> append one event to the append-only audit log
//
// The server runs from the ADG repo root so the wrapped scripts see data/ and
// config/. Start it with: npm run adg:mcp

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Run a wrapped governance script with an argv array (no shell -> no injection).
function runScript(scriptRelPath, args) {
  const res = spawnSync(process.execPath, [path.join(root, scriptRelPath), ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const stdout = (res.stdout ?? "").trim();
  const stderr = (res.stderr ?? "").trim();
  if (res.status !== 0) {
    throw new Error(stderr || stdout || `${scriptRelPath} exited ${res.status}`);
  }
  return stdout;
}

const TOOLS = [
  {
    name: "classify_work",
    description: "Classify a unit of work into its Proofline delivery lane (L0-L4), risk, workflow, whether an audit and full governance gate are required, and the checks to run. Read-only. Always classify before starting material work.",
    inputSchema: {
      type: "object",
      properties: {
        intent: { type: "string", description: "What you intend to do, e.g. 'add an evidence_tier column to the schema'." },
        file: { type: "string", description: "Optional primary file the work touches, e.g. 'data/schema.sql'." },
      },
      required: ["intent"],
    },
    readOnly: true,
    run(input) {
      const args = ["classify", "--intent", String(input.intent)];
      if (input.file) args.push("--file", String(input.file));
      return runScript("scripts/adg-work-classify.mjs", args);
    },
  },
  {
    name: "context_packet",
    description: "Return a bounded ADG context packet for a feature or backlog item (feature/items/routes/recent audit/next files). Read-only and side-effect-free (no manifest is written). Generate this before opening source files instead of bulk-reading.",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature id, e.g. 'S07'. Provide either feature or item." },
        item: { type: "string", description: "Backlog item id, e.g. 'S07-TASK-01'. Provide either feature or item." },
        workflow: { type: "string", description: "Context workflow profile (default: agentic-tooling)." },
        format: { type: "string", enum: ["json", "markdown", "toon"], description: "Output format (default: json)." },
      },
    },
    readOnly: true,
    run(input) {
      const format = input.format || "json";
      const workflow = input.workflow || "agentic-tooling";
      if (input.item) {
        return runScript("scripts/agent-context.mjs", ["item", "--item", String(input.item), "--workflow", workflow, "--format", format, "--no-manifest"]);
      }
      if (input.feature) {
        return runScript("scripts/agent-context.mjs", ["feature", "--feature", String(input.feature), "--workflow", workflow, "--format", format, "--no-manifest"]);
      }
      throw new Error("context_packet requires either a feature or an item id.");
    },
  },
  {
    name: "record_audit",
    description: "Append one event to ADG's append-only audit log (and mirror it to the database). APPEND-ONLY: this never rewrites history; corrections are appended as new comment/decision events. Record an audit event before finishing material work. Pass --tier-appropriate evidence: asserted < config < test < live.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "One-line summary of what happened (no secrets)." },
        type: { type: "string", description: "Event type: status | comment | evidence | test-result | decision | scope-change | workspace-state (default: comment)." },
        status: { type: "string", description: "Optional lifecycle status, e.g. 'in-progress', 'verified'." },
        feature: { type: "string", description: "Optional feature id the event concerns." },
        tier: { type: "string", enum: ["asserted", "config", "test", "live"], description: "Evidence tier backing the claim (default: asserted)." },
        evidence: { type: "array", items: { type: "string" }, description: "Commands or paths that back the claim." },
        details: { type: "string", description: "Optional longer detail (no secrets)." },
      },
      required: ["summary"],
    },
    readOnly: false,
    run(input) {
      const args = ["--summary", String(input.summary)];
      if (input.type) args.push("--type", String(input.type));
      if (input.status) args.push("--status", String(input.status));
      if (input.feature) args.push("--feature", String(input.feature));
      if (input.tier) args.push("--tier", String(input.tier));
      if (input.details) args.push("--details", String(input.details));
      for (const ev of Array.isArray(input.evidence) ? input.evidence : []) args.push("--evidence", String(ev));
      return runScript("scripts/record-audit.mjs", args);
    },
  },
];

const server = new Server(
  { name: "adg-governance", version: "0.4.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: TOOLS.map(({ name, description, inputSchema, readOnly }) => ({
    name,
    description,
    inputSchema,
    annotations: { readOnlyHint: Boolean(readOnly) },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
  }
  try {
    const text = tool.run(request.params.arguments ?? {});
    return { content: [{ type: "text", text }] };
  } catch (error) {
    return { isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }] };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr is safe for logs; stdout is the JSON-RPC channel.
  process.stderr.write("[adg-mcp] governance server ready (classify_work, context_packet, record_audit)\n");
}

main().catch((error) => {
  process.stderr.write(`[adg-mcp] fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
