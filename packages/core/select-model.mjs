// ADG model orchestrator — pure capability-tier selection.
//
// Effort-first, capability-as-floor. The loop's *effort* (its ADG lane L0..L4) picks a
// base tier; risk class and role can only RAISE it, never lower it. We never select a
// model by name in code: we select an abstract TIER and resolve the tier to a provider
// model id through config/agentic/models.json, so ADG stays provider-neutral and no model
// id is hardcoded anywhere outside that one editable policy file.
//
// This mirrors how AgentDefinition.model + AgentDefinition.effort are passed to the Claude
// Agent SDK, and how model/model_settings are passed per-run to the OpenAI Agents SDK. The
// orchestrator's output type IS the vendor SDK's input — we build on those loops, not over
// them.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIER_ORDER = ["economy", "fast-reasoning", "balanced", "frontier-reasoning"];

// Resolve config/agentic/models.json from an explicit path, the cwd, or up from this file.
export function loadModelPolicy(explicitPath) {
  const candidates = [];
  if (explicitPath) candidates.push(explicitPath);
  if (process.env.ADG_MODELS_PATH) candidates.push(process.env.ADG_MODELS_PATH);
  candidates.push(path.join(process.cwd(), "config/agentic/models.json"));
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const up of ["..", "../..", "../../..", "../../../.."]) {
      candidates.push(path.join(here, up, "config/agentic/models.json"));
    }
  } catch {
    /* ignore */
  }
  for (const file of candidates) {
    try {
      if (file && fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* try next candidate */
    }
  }
  throw new Error("ADG model policy not found (config/agentic/models.json)");
}

function rank(tierOrder, tier) {
  const i = tierOrder.indexOf(tier);
  return i === -1 ? -1 : i;
}

// Pick the highest-capability tier among the applicable rules (floor semantics: max).
function maxTier(tierOrder, tiers) {
  let best = null;
  let bestRank = -1;
  for (const t of tiers) {
    if (!t) continue;
    const r = rank(tierOrder, t);
    if (r > bestRank) {
      bestRank = r;
      best = t;
    }
  }
  return best;
}

/**
 * Select a capability tier, model id, and reasoning effort for a unit of work.
 *
 * @param {object} input
 * @param {string} [input.lane]   ADG lane: L0|L1|L2|L3|L4 (the effort axis).
 * @param {string} [input.risk]   risk class: secrets|billing|production|migration|destructive|...
 * @param {string} [input.role]   orchestration role: planner|judge|worker|mechanical-worker|...
 * @param {string} [input.provider]  override the policy's default provider.
 * @param {string} [input.tier]   explicit tier override (e.g. a human decision); still resolved + reasoned.
 * @param {object} policy         a loaded models.json (defaults to loadModelPolicy()).
 * @returns {{tier,model,effort,provider,reason,floors:object}}
 */
export function selectModel(input = {}, policy = loadModelPolicy()) {
  const tierOrder = Array.isArray(policy.tierOrder) && policy.tierOrder.length ? policy.tierOrder : DEFAULT_TIER_ORDER;
  const provider = input.provider || policy.provider || "anthropic";
  const sel = policy.selection || {};
  const lane = input.lane || "L2";
  const risk = input.risk || null;
  const role = input.role || null;

  const laneTier = (sel.byLane && sel.byLane[lane]) || "balanced";
  const riskTier = risk && sel.riskFloor ? sel.riskFloor[risk] || null : null;
  const roleTier = role && sel.roleFloor ? sel.roleFloor[role] || null : null;
  const explicitTier = input.tier || null;

  // explicit override is honored as a floor too: it can raise but a risk floor still wins,
  // so a human cannot accidentally undercut a sensitive-risk requirement.
  const tier = maxTier(tierOrder, [laneTier, riskTier, roleTier, explicitTier]) || laneTier;

  const tierDef = (policy.tiers && policy.tiers[tier]) || {};
  const model = tierDef[provider];
  if (!model) {
    throw new Error(`model policy has no '${provider}' model for tier '${tier}'`);
  }
  const effort = (policy.effort && policy.effort.byLane && policy.effort.byLane[lane]) || "medium";

  // Explain which rule decided the tier (transparency / P7).
  const floors = { lane: laneTier, risk: riskTier, role: roleTier, explicit: explicitTier };
  const decidedBy = Object.entries(floors)
    .filter(([, t]) => t === tier && t)
    .map(([k]) => k);
  const reason =
    `tier '${tier}' from ${decidedBy.length ? decidedBy.join("+") : "lane"} ` +
    `(lane ${lane}=${laneTier}${risk ? `, risk ${risk}=${riskTier || "—"}` : ""}` +
    `${role ? `, role ${role}=${roleTier || "—"}` : ""}); ` +
    `${provider} model ${model}, effort ${effort}`;

  return { tier, model, effort, provider, reason, floors };
}
