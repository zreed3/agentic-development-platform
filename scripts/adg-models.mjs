#!/usr/bin/env node
// ADG model orchestrator CLI.
//
//   npm run models:select -- --lane L3 --risk secrets --role worker [--provider openai] [--format json]
//
// Prints the chosen capability tier, the resolved provider model id, the reasoning effort,
// and the rule that decided it. Deterministic and transparent: the same inputs always pick
// the same tier, and the `reason` names which floor (lane/risk/role/explicit) won.

import { selectModel, loadModelPolicy } from "../packages/core/select-model.mjs";

function parseArgs(argv) {
  const out = { command: argv[0] && !argv[0].startsWith("--") ? argv[0] : "select", values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (!t.startsWith("--")) continue;
    const key = t.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out.values[key] = next;
      i += 1;
    } else {
      out.values[key] = true;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const v = args.values;

try {
  const policy = loadModelPolicy(typeof v.policy === "string" ? v.policy : undefined);

  if (args.command === "tiers") {
    // List the tier->model table for the active (or requested) provider.
    const provider = (typeof v.provider === "string" && v.provider) || policy.provider || "anthropic";
    const rows = (policy.tierOrder || Object.keys(policy.tiers || {})).map((tier) => ({
      tier,
      model: policy.tiers?.[tier]?.[provider] ?? "—",
      use: policy.tiers?.[tier]?._use ?? "",
    }));
    if (v.format === "json") {
      process.stdout.write(`${JSON.stringify({ provider, tiers: rows }, null, 2)}\n`);
    } else {
      process.stdout.write(`ADG model tiers (provider: ${provider})\n`);
      for (const r of rows) process.stdout.write(`  ${r.tier.padEnd(20)} ${String(r.model).padEnd(22)} ${r.use}\n`);
    }
    process.exit(0);
  }

  // default: select
  const result = selectModel(
    {
      lane: typeof v.lane === "string" ? v.lane : undefined,
      risk: typeof v.risk === "string" ? v.risk : undefined,
      role: typeof v.role === "string" ? v.role : undefined,
      provider: typeof v.provider === "string" ? v.provider : undefined,
      tier: typeof v.tier === "string" ? v.tier : undefined,
    },
    policy,
  );

  if (v.format === "json") {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`tier:     ${result.tier}\n`);
    process.stdout.write(`model:    ${result.model}  (${result.provider})\n`);
    process.stdout.write(`effort:   ${result.effort}\n`);
    process.stdout.write(`reason:   ${result.reason}\n`);
  }
  process.exit(0);
} catch (err) {
  process.stderr.write(`[adg-models] ${err && err.message}\n`);
  process.exit(1);
}
