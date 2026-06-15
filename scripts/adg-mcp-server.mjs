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
import fs from "node:fs";
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

// Refuse to forward likely secret material into the append-only audit log. Keeping
// secrets out of the log is itself a control (LLM02 sensitive-information disclosure);
// the log is append-only, so a secret written once cannot be rewritten away.
const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9]{16,}\b/,
  /\bAKIA[0-9A-Z]{12,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\b(password|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/i,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
];
function looksLikeSecret(text) {
  return typeof text === "string" && SECRET_PATTERNS.some((re) => re.test(text));
}

// Canonical control registry (mirrors scripts/guardrail-check.mjs) for input validation.
const KNOWN_CONTROLS = new Set([
  "destructiveDeny", "auditAppendOnly", "forbiddenBulkRead",
  "secretsConfirm", "productionConfirm", "migrationConfirm", "billingConfirm", "controlFileGuard",
]);

// Read the controls block from the single policy source. Read-only by construction:
// this loads and parses JSON; it NEVER spawns a script and in particular never invokes
// the governed toggle. Toggling stays on the audited CLI path (adg-toggle-control.mjs).
function readControlState(controlName) {
  const policyFile = path.join(root, "config/agentic/guardrails.json");
  if (controlName !== undefined && !KNOWN_CONTROLS.has(controlName)) {
    throw new Error(`Unknown control "${controlName}". Known: ${[...KNOWN_CONTROLS].join(", ")}`);
  }
  let policy;
  try {
    policy = JSON.parse(fs.readFileSync(policyFile, "utf8"));
  } catch {
    return { policyFound: false, controlsVersion: null, mandatoryAlwaysOn: [], controls: [], disabled: [] };
  }
  const defs = policy.controls?.definitions ?? {};
  const names = controlName ? [controlName] : Object.keys(defs);
  const controls = names.filter((n) => defs[n]).map((n) => ({
    name: n,
    enabled: defs[n].enabled !== false,
    alwaysOn: defs[n].alwaysOn === true,
    effect: defs[n].effect,
    appliesTo: defs[n].appliesTo ?? null,
  }));
  return {
    policyFound: true,
    controlsVersion: policy.controls?.version ?? null,
    mandatoryAlwaysOn: policy.controls?.mandatoryAlwaysOn ?? [],
    controls,
    disabled: controls.filter((c) => !c.enabled).map((c) => c.name),
  };
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
    outputSchema: {
      type: "object",
      properties: {
        lane: { type: "string", description: "Lane label, e.g. 'L3 sensitive'." },
        laneId: { type: "string", description: "L0..L4." },
        contextWorkflow: { type: "string" },
        auditRequired: { type: "boolean" },
        fullGateRequired: { type: "boolean" },
        files: { type: "array", items: { type: "string" } },
        reasons: { type: "array", items: { type: "string" } },
      },
      required: ["lane", "laneId", "auditRequired", "fullGateRequired"],
    },
    readOnly: true,
    run(input) {
      const args = ["classify", "--intent", String(input.intent), "--format", "json"];
      if (input.file) args.push("--file", String(input.file));
      const json = JSON.parse(runScript("scripts/adg-work-classify.mjs", args));
      const structured = {
        lane: json.lane,
        laneId: json.laneId,
        contextWorkflow: json.contextWorkflow,
        auditRequired: Boolean(json.auditRequired),
        fullGateRequired: Boolean(json.fullGateRequired),
        files: json.files ?? [],
        reasons: json.reasons ?? [],
      };
      const text = `${json.lane} | workflow ${json.contextWorkflow} | audit ${structured.auditRequired} | fullGate ${structured.fullGateRequired}`;
      return { text, structured };
    },
  },
  {
    name: "context_packet",
    description: "Return a bounded ADG context packet for a feature or backlog item (feature/items/routes/recent audit/next files). Read-only and side-effect-free (no manifest is written). Generate this before opening source files instead of bulk-reading. Defaults to the compact TOON serialization (about 3.6x fewer tokens than JSON for the same packet); pass format:'json' for a machine-parseable object.",
    inputSchema: {
      type: "object",
      properties: {
        feature: { type: "string", description: "Feature id, e.g. 'S07'. Provide either feature or item." },
        item: { type: "string", description: "Backlog item id, e.g. 'S07-TASK-01'. Provide either feature or item." },
        workflow: { type: "string", description: "Context workflow profile (default: agentic-tooling)." },
        format: { type: "string", enum: ["json", "markdown", "toon"], description: "Output format (default: toon, the most token-efficient)." },
      },
    },
    readOnly: true,
    run(input) {
      const format = input.format || "toon";
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
    name: "control_state",
    description: "Return the current guardrail control state from the single policy source: each control's enabled/alwaysOn/effect, the always-on set, the controls version, and which controls are disabled. STRICTLY READ-ONLY: it reads the policy file and never toggles anything. To change a control, use the governed CLI (npm run guardrails:toggle), which writes an append-only audit decision.",
    inputSchema: {
      type: "object",
      properties: {
        control: { type: "string", description: "Optional single control name to inspect (e.g. 'productionConfirm'); omit for all." },
      },
    },
    outputSchema: {
      type: "object",
      properties: {
        policyFound: { type: "boolean" },
        controlsVersion: { type: ["string", "null"] },
        mandatoryAlwaysOn: { type: "array", items: { type: "string" } },
        controls: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              enabled: { type: "boolean" },
              alwaysOn: { type: "boolean" },
              effect: { type: "string" },
            },
            required: ["name", "enabled", "alwaysOn"],
          },
        },
        disabled: { type: "array", items: { type: "string" } },
      },
      required: ["policyFound", "controls"],
    },
    readOnly: true,
    run(input) {
      const structured = readControlState(input.control ? String(input.control) : undefined);
      const text = structured.policyFound
        ? `${structured.controls.length} controls (version ${structured.controlsVersion}); disabled: ${structured.disabled.join(", ") || "none"}; always-on: ${structured.mandatoryAlwaysOn.join(", ")}`
        : "no policy found";
      return { text, structured };
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
    outputSchema: {
      type: "object",
      properties: {
        recorded: { type: "string", description: "The new append-only event id." },
        eventType: { type: "string" },
        featureId: { type: "string" },
        evidenceTier: { type: "string", enum: ["asserted", "config", "test", "live"] },
        mirroredToDb: { type: "boolean" },
      },
      required: ["recorded", "evidenceTier"],
    },
    readOnly: false,
    run(input) {
      // Redaction at the boundary: refuse to append likely secrets to the append-only log.
      for (const field of ["summary", "details"]) {
        if (looksLikeSecret(input[field])) {
          throw new Error(`record_audit refused: '${field}' looks like it contains secret material. Audit events are append-only; never write secrets, tokens, or credentials.`);
        }
      }
      for (const ev of Array.isArray(input.evidence) ? input.evidence : []) {
        if (looksLikeSecret(ev)) throw new Error("record_audit refused: an evidence value looks like secret material.");
      }
      const args = ["--summary", String(input.summary)];
      if (input.type) args.push("--type", String(input.type));
      if (input.status) args.push("--status", String(input.status));
      if (input.feature) args.push("--feature", String(input.feature));
      if (input.tier) args.push("--tier", String(input.tier));
      if (input.details) args.push("--details", String(input.details));
      for (const ev of Array.isArray(input.evidence) ? input.evidence : []) args.push("--evidence", String(ev));
      const structured = JSON.parse(runScript("scripts/record-audit.mjs", args));
      return { text: `recorded ${structured.recorded} (${structured.evidenceTier})`, structured };
    },
  },
];

const server = new Server(
  { name: "adg-governance", version: "1.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, () => ({
  tools: TOOLS.map(({ name, description, inputSchema, outputSchema, readOnly }) => ({
    name,
    description,
    inputSchema,
    ...(outputSchema ? { outputSchema } : {}),
    annotations: { readOnlyHint: Boolean(readOnly) },
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = TOOLS.find((t) => t.name === request.params.name);
  if (!tool) {
    return { isError: true, content: [{ type: "text", text: `Unknown tool: ${request.params.name}` }] };
  }
  try {
    const result = tool.run(request.params.arguments ?? {});
    // A tool may return a plain string (text only) or { text, structured }. When an
    // outputSchema is declared the MCP spec requires structuredContent, so we emit it.
    if (typeof result === "string") {
      return { content: [{ type: "text", text: result }] };
    }
    return {
      content: [{ type: "text", text: result.text }],
      ...(result.structured !== undefined ? { structuredContent: result.structured } : {}),
    };
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
