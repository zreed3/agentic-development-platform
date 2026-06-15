# ADG Governance Alignment Assessment

How the Agentic Development Platform (ADG) controls map to recognised AI and risk
governance frameworks: the OWASP Top 10 for LLM Applications, ISO/IEC 42001 (AI
management system), the IIA Three Lines Model (2020), and ISO 31000 (risk management).

Compiled 2026-06-15 for the 1.0 release. Style rule: no em dashes.

## Why external, deterministic enforcement

ADG's thesis is that a guardrail trained into a model can be talked around with a
prompt, but a guardrail enforced outside the model (a deterministic PreToolUse hook,
a deny-by-default policy, an append-only audit log) cannot be. The June 2026 Fable 5
and Mythos 5 access suspension, triggered by a narrow prompt that bypassed an in-model
safeguard, is the motivating case. ADG therefore places its controls at the tool gate
and in the audit record, not in model behaviour. The 1.0 toggleable-controls work keeps
this property: toggling a control is itself a governed, audited action, and the
always-on controls (destructive deny, audit append-only, forbidden-bulk read) are
pinned in code so no configuration toggle can reach them.

## Headline alignment table

| ADG element | OWASP LLM Top 10 | ISO/IEC 42001 and Three Lines / ISO 31000 |
| --- | --- | --- |
| Deny-by-default tool guardrails (evidence and confirmation per risk class), enforced by a deterministic PreToolUse hook | LLM01 Prompt injection; LLM06 Excessive agency | 42001 operational controls; first-line preventive control |
| Toggleable controls as policy-as-code (safe deny-by-default, always-on pins, audited toggles) | LLM01 Prompt injection; LLM06 Excessive agency | 42001 change management and operational controls; first-line control with second-line assurance and a third-line toggle trail |
| AI-security evals as a pre-merge gate (now driving the real hook, plus indirect-injection and multi-agent-propagation scenarios) | Direct LLM Top 10 coverage | 42001 AI system testing and impact; second-line independent assurance |
| Append-only, event-sourced audit; decision events (reason, risk, rollback) | Supports incident traceability | 42001 record-keeping and traceability; ISO 31000 monitoring and review; non-repudiation for third-line audit |
| Context broker, bounded packets, richest artifacts withheld | Reduces injection surface from bulk context | Data minimisation; ISO 31000 risk treatment |
| DORA metrics from git and the audit log | Not applicable (delivery metric) | 42001 continual improvement (PDCA); ISO 31000 performance monitoring |
| AGENTS.md rulebook plus solo-dev gates | Not applicable (policy and roles) | 42001 AI policy and roles; three-lines accountability even for a team of one |

## Three Lines mapping

The IIA Three Lines Model separates the people who own and manage risk (first line),
the people who provide assurance and oversight (second line), and independent audit
(third line). ADG implements all three even for a solo developer, because the controls
are code, not headcount.

- First line (own and manage risk at the point of action): the deterministic PreToolUse
  hook (`plugins/adg-governance/hooks/adg-guardrail-hook.mjs`) and the deny-by-default
  policy (`config/agentic/guardrails.json`). These block or ask at the tool gate.
- Second line (assurance and oversight): the governance gate (`npm run ci:governance`),
  the guardrail policy validator (`npm run guardrails:check`, which rejects a relaxed
  always-on control), the AI-security evals (`npm run agent:evals`, which now exercises
  the real hook), and the release evidence gate.
- Third line (independent review): the append-only, event-sourced audit log
  (`data/audit/audit-log.jsonl`) with decision events carrying reason, risk, and
  rollback. It is append-only at the hook (truncation, overwrite, and in-place edit are
  blocked) and via the recorder, so the record supports non-repudiation.

## OWASP LLM Top 10 coverage

- LLM01 Prompt injection (direct and indirect): the hook treats tool inputs as data,
  not instructions, and blocks or asks regardless of any injected text. Eval scenarios
  AE-002 (direct), AE-006 (indirect injection in untrusted content), and AE-007
  (multi-agent propagation) cover the vector. The context broker reduces the bulk-content
  surface that indirect injection rides on.
- LLM02 Sensitive information disclosure: the MCP `record_audit` boundary refuses likely
  secret material, and the policy `redactFields` list plus `audit:validate` flag likely
  secrets so they do not enter the append-only log.
- LLM06 Excessive agency: deny-by-default risk classes, confirmation for
  secrets/production/migration/billing, and the always-on destructive-deny floor.
  Scenario AE-003 (destructive deny) and AE-008 (toggle-as-jailbreak) cover the boundary.
- LLM08 and the broader autonomy vector: toggling a control cannot silently expand
  agency, because always-on controls are unreachable and every toggle is audited.

## ISO/IEC 42001 operational controls

- Operational planning and control: the policy and the hook are the operational control
  surface. ISO 42001 Annex A operational controls map to the deny-by-default gate.
- AI system impact and testing: the eval gate and the negative tests
  (`npm run test:adg-hook`, `npm run test:adg-toggles`) are the testing evidence.
- Record-keeping and traceability: the append-only audit log and the requirements-to-UX
  lineage graph.
- Continual improvement (the PDCA loop): DORA metrics derived from git and the audit log.
- AI policy and roles: AGENTS.md is the machine-checked rulebook; the solo-dev gate
  rules keep accountability even without a second reviewer.

## ISO 31000 risk management

- Risk treatment: bounded context packets (reduce the injection surface) and the
  confirmation controls (treat the residual risk of sensitive actions).
- Monitoring and review: the audit log and DORA proxies provide the monitoring signal.
- Recording and reporting: every material action and every control toggle is recorded.

## Per-control detail

The machine-readable mapping lives in `config/agentic/standards-map.json` and is checked
by `npm run standards:validate`. Controls ADG-CTRL-001 through ADG-CTRL-008 carry their
standard references, OWASP LLM references, ISO 42001 references, and Three Lines role.
ADG-CTRL-007 (toggleable controls as code) is new in 1.0 and ties the policy source, the
governed toggle, the deterministic hook, and the negative tests together. ADG-CTRL-008
(deliverable artifact quality) is new in 1.1: it maps to ISO 42001 AI system testing and is
a first-line deterministic quality gate (asset-lint) with second-line typed-deliverable
assurance (deliverable:audit) and a third-line evidence trail, so a deliverable that renders
to a user inherits a versioned check set rather than relying on the authoring agent's memory.

## Sources

- OWASP Top 10 for LLM Applications: https://owasp.org/www-project-top-10-for-large-language-model-applications/
- OWASP LLM01:2025 Prompt Injection: https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- ISO/IEC 42001 AI management system: https://www.iso.org/standard/42001
- ISO/IEC 42001 Annex A controls overview: https://www.isms.online/iso-42001/annex-a-controls/
- IIA Three Lines Model (2020): https://www.theiia.org/en/content/position-papers/2020/the-iias-three-lines-model-an-update-of-the-three-lines-of-defense/
- ISO 31000 risk management: https://www.iso.org/standard/65694.html
- Meta LlamaFirewall (open guardrail prior art): https://ai.meta.com/research/publications/llamafirewall-an-open-source-guardrail-system-for-building-secure-ai-agents/
- Anthropic statement on Fable 5 and Mythos 5 access: https://www.anthropic.com/news/fable-mythos-access
