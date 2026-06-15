---
title: "Most teams are governing their AI coding agents wrong"
description: "An introduction to Agentic Development Governance (ADG): governing a fleet of AI agents with the discipline of a regulated engineering org."
author: "Zach Reeder"
date: "2026-06-15"
tags: ["AI governance", "agentic development", "technology risk", "ADG"]
---

# Most teams are governing their AI coding agents wrong

*Zach Reeder · Otterblock Pty Ltd · June 2026*

## Executive summary

Most teams rolling out AI coding agents are solving the wrong problem. They tune prompts and grade output. The real exposure is the one every engineering org already knows: no limit on what a worker can touch, and no reliable record of what they did. With one agent that is a nuisance you can absorb. With a team of agents it is a governance gap you cannot.

Agentic Development Governance (ADG) closes that gap by giving a fleet of agents the apparatus of a regulated engineering shop: least privilege by default, an append-only audit trail, security evals that run before work is accepted, and a database that hands each agent a bounded slice of context instead of the firehose.

This is an introduction and a set of opinions, not a specification. It is the groundwork a formal framework can be built on, and it already runs in a handful of Node scripts and one SQLite file.

## The wrong problem

A single agent on your codebase is easy to supervise. A team of them is not. They work in parallel, faster than anyone can review. Nobody checks every change. And feeding each agent enough context to be useful multiplies the token cost.

The failure modes are familiar once you name them. Agents do too much: unbounded, unaudited, occasionally destructive actions. Or they drown in context: you paste the whole tracker into the prompt and burn a fortune in tokens before a line is written. Prompt-tuning does nothing for either one. Both are governance problems wearing engineering clothes.

## The reframe: a fleet is a workforce

Treat the fleet the way a regulated engineering org treats its workforce. ADG is a SQL-first, deny-by-default governance layer for agent-assisted development. It runs on Node and the `sqlite3` CLI. No SaaS, no agent framework, no vector database. Five design principles drive every part of it.

## The inversion: your richest artifacts are context hazards

Mainstream context tools maximise what they pack into the prompt. ADG does the opposite. The full SQL dump, the JSON mirrors and the generated HTML go on a denylist, and SQLite selects a capped packet of pointers instead.

The pipeline is simple:

> task → classify → SQL lookup → capped context packet → anchored files → targeted checks

The reasoning is quantitative. On the seeded demo backlog, a context packet is about 2.0 KB (TOON) or 2.8 KB (markdown) against the roughly 26 KB SQL dump and 164 KB database it stands in for. At real-project scale the gap is decisive: the generated mirrors ran to multiple megabytes, hundreds of thousands of tokens, while the bounded instruction set stayed around 4–7k tokens. Your richest artifacts are the ones most likely to poison the context window, so the broker's whole job is to withhold them and hand back pointers.

## The five principles

1. **Treat your own generated artifacts as context hazards, not assets.** The intuitive move is to feed the agent everything. Do the opposite: denylist the rich mirrors and let the database select a capped packet.
2. **Build the governance for an audience of agents.** The audit trail, the event log, the decision events with reason, risk and rollback exist so that a non-human collaborator's work is non-repudiable, even for a team of one. If no reviewer is available, enforce strict solo-dev gates.
3. **Threat-model your own agents as untrusted insiders.** Guardrails default to deny. Prompt injection, cross-scope escalation and excessive agency are standing assumptions written ahead of time, not reactions after an incident.
4. **Borrow append-only discipline from event sourcing.** Never rewrite an audit event; correct it by appending another. Current state is derived from the event stream through SQL views, so neither the agent nor a future you can quietly launder history.
5. **Restraint in the implementation.** Node, `sqlite3` and JSONL. No SaaS, no vector database, no production RAG for the dev pipeline. Grep-able, diffable, offline, fast.

## Both an SDLC problem and an AI-risk problem

The evals — prompt-injection, excessive-agency and resilience scenarios — run as a pre-merge gate, mapped to the OWASP LLM Top 10 and paired with the NIST SSDF and NIST AI RMF inside the platform. Read as a management-system control, this is the operational discipline an ISO/IEC 42001 AI management system expects: policy, records, testing, improvement. In three-lines terms, the fleet of agents is first-line delivery; the gates, evals and audit are second-line assurance; and the immutable trail is what a third-line audit relies on.

| ADG element | OWASP LLM Top 10 | ISO/IEC 42001 · Three Lines / ISO 31000 |
| --- | --- | --- |
| Deny-by-default tool guardrails (evidence + confirmation per risk class) | LLM01 Prompt injection; LLM06 Excessive agency | 42001 operational controls; first-line preventive control |
| AI-security evals as a pre-merge gate | Direct LLM Top 10 coverage | 42001 AI system testing & impact; second-line independent assurance |
| Append-only, event-sourced audit; decision events (reason / risk / rollback) | Supports incident traceability | 42001 record-keeping & traceability; ISO 31000 monitoring & review; non-repudiation for third-line audit |
| Context broker — bounded packets; richest artifacts withheld | Reduces injection surface from bulk context | Data minimisation; ISO 31000 risk treatment |
| DORA metrics from git + audit log | — | 42001 continual improvement (PDCA); ISO 31000 performance monitoring |
| `AGENTS.md` rulebook + solo-dev gates | — | 42001 AI policy & roles; three-lines accountability even for a team of one |

## What it deliberately is not

This is uncommon, not unprecedented: an assembly of known patterns executed with discipline, plus one genuinely fresh inversion. There is no production RAG for the dev pipeline. TOON exists only as a compact, LLM-facing transport, with JSON and SQL kept canonical.

There is also an honest tension worth stating. The experiment in how to feed context to agents once escaped governance — it lived as out-of-band, reversible tooling. The fix was to bring it back under a gate as a first-class, tested component. The lesson generalises: when ceremony starts getting routed around instead of followed, make the routing explicit and bring it back under a gate.

## Toward a formal framework

This piece is the thinking. A formal ADG framework would add the scaffolding an organisation can adopt: a control catalogue, a maturity model, roles and accountabilities including a three-lines mapping, the evidence each control must produce, and a full standards crosswalk. If you run agents in anger, I would value your pressure-testing of these principles.

## The platform

ADG is source-available for non-commercial use from Otterblock Pty Ltd.

- [agentic-development-platform](https://github.com/zreed3/agentic-development-platform) — the platform: guardrails, append-only audit, AI-security evals, DORA metrics, and the context broker.
- [adg-codex-plugin](https://github.com/zreed3/adg-codex-plugin) — ADG packaged as an installable control-plane plugin.

Commercial use: `zach+github@otterblock.com.au`.
