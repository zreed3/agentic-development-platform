---
description: Choose the model tier + reasoning effort for a unit of work, by ADG lane / risk / role.
argument-hint: [e.g. --lane L3 --risk secrets --role worker]
---

Select the model capability tier and reasoning effort for the work, using ADG's effort-first
policy (`config/agentic/models.json`). Risk class and role can only *raise* the tier, never
lower it, so a sensitive task is never under-powered.

Run the orchestrator:

`npm run models:select -- $ARGUMENTS`

Report back: the chosen **tier** (economy / fast-reasoning / balanced / frontier-reasoning),
the resolved **model** for the active provider, the **reasoning effort**, and the **rule** that
decided the tier (lane vs risk vs role floor).

When orchestrating sub-agents, feed each worker the tier for its own item — pass `--lane` from
the item's Proofline lane and `--risk` from its risk class — and give each agent only its
bounded context slice (`npm run context:item -- --item <id>`) plus its write scope. See
`@adg/sdk` `governAgentModel()` to emit `{model, effort}` straight into a Claude Agent SDK
`AgentDefinition`, or `modelSettingsFor()` for the OpenAI Agents SDK.
