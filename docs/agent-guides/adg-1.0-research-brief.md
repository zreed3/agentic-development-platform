# ADG 1.0 Research Brief

Pre-research grounding for the ADG 0.9.1 to 1.0 ultra loop. The build agents should
treat this as the starting evidence base, then have the live research swarm reconcile
it against the latest papers each loop and cite anything new.

Date compiled: 2026-06-15. Author: Zach Reeder (OtterBlock Pty Ltd).
Style rule for all generated output: no em dashes.

## 0. Why this matters now (motivating case)

In June 2026 the US government forced Anthropic to suspend Fable 5 and Mythos 5 over a
claimed narrow jailbreak: prompting the model to read a specific codebase and identify
software vulnerabilities, bypassing an in-model safeguard
([Anthropic statement](https://www.anthropic.com/news/fable-mythos-access),
[Bloomberg](https://www.bloomberg.com/news/articles/2026-06-13/anthropic-says-us-limits-foreign-access-to-fable-5-mythos-5)).
The lesson for ADG: a guardrail trained into a model can be talked around with a prompt;
a guardrail enforced outside the model (a deterministic PreToolUse hook, deny-by-default
policy, append-only audit) cannot be. ADG's whole value proposition is external,
deterministic enforcement. The 1.0 work should deepen that, not dilute it, and the new
"toggleable controls" axis must keep toggling itself a governed, audited action so it
never becomes the jailbreak.

## 1. Token reduction and context efficiency

**What the research says.** The guiding principle is to find the smallest set of
high-signal tokens that maximise the likelihood of the desired outcome, and to treat the
context window as a finite, decaying resource (context rot). Practical levers:

- Tools should return token-efficient payloads (pagination, range selection, filtering,
  truncation with sensible defaults) and should nudge agents toward many small, targeted
  retrievals over one broad dump.
- Context editing / rule-based pruning inside the scaffold keeps the window bounded.
- Programmatic tool calling lets code consume intermediate tool outputs and return only
  the final processed result, so raw intermediate data never enters the model context.
- Sub-agent context isolation: push read-heavy exploration into a separate context window
  and return only the conclusion to the parent.
- Prompt caching is the cheapest single win: cache hits cost about 10% of a standard input
  token (up to 90% saving) when a stable prefix is reused. It must be turned on and the
  prompt must be structured as a stable prefix plus a small variable suffix. Real-world
  reports land in the 59 to 90% cost-reduction range for agent workloads.

**Key sources.**
[Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
[Anthropic: Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents),
[ProjectDiscovery: 59% LLM cost cut with prompt caching](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching).

**ADG actions.**
- Audit every command's stdout (context packets, gate output, validator JSON) for token
  bloat. Add a measured before/after token count to each change; do not accept "smaller"
  as asserted.
- Make context packets prefix-stable so a host's CLAUDE.md plus guardrails.json plus the
  packet head can be cached, with only the feature-specific slice varying.
- Confirm the bounded-context broker uses targeted slices, not bulk reads, and keep the
  forbiddenBulkFiles denylist enforced.
- Prefer structured, compact serialisations (the repo already references TOON) over verbose
  JSON for LLM-facing packets where a schema is fixed.

## 2. Better LLM responses (structured and constrained outputs)

**What the research says.** Structured outputs are becoming the default contract for LLM
integrations. Constrained decoding (JSON Schema, grammars: Outlines, XGrammar, Guidance)
guarantees the shape of output and removes a whole class of parse failures, and XGrammar
shows large speedups over older grammar methods. Critical caveat: constrained decoding
guarantees syntactic conformance, not semantic correctness. When shape errors drop, the
remaining failures are wrong-but-valid values. So schemas raise reliability of form, and
you still need evals or judges for correctness of meaning.

**Key sources.**
[JSONSchemaBench (arXiv 2501.10868)](https://arxiv.org/pdf/2501.10868),
[Structured outputs as the default contract](https://g360technologies.com/structured-outputs-are-becoming-the-default-contract-for-llm-integrations/).

**ADG actions.**
- Give the MCP tools (classify_work, context_packet, record_audit) and the validators
  strict output schemas, and have agents emit schema-validated results rather than prose.
- Tighten command outputs so the high-signal fields come first and noise is dropped.
- Pair every structured output with a check or judge for semantic correctness, because
  schema-valid does not mean correct.

## 3. Multi-agent orchestration and judging

**What the research says.** Multi-agent wins when a task decomposes into independent,
parallel threads, and it pays for it: Anthropic's research system beat single-agent by a
large margin but used roughly 15x the tokens, and token usage alone explained about 80% of
the performance variance. Multi-agent systems also fail often (reported 41 to 86.7% failure
in some production studies). The MAST taxonomy groups 14 failure modes into design and
specification shortcomings, inter-agent misalignment, and verification and termination
failures. Counter-evidence exists too: under equal token budgets a single agent can match
or beat multi-agent on some multi-hop reasoning, so multi-agent is not a free lunch.

**On judging.** LLM-as-judge is useful but biased: judges favour longer, authoritative,
well-formatted answers, exhibit self-preference (preferring their own generations),
positional bias (judge-model choice drives this more than task or length), and can be
swayed by prompt injection. For code specifically, judges carry extra biases. Mitigations:
randomise order, shuffle rubrics, use explicit debiasing and detailed rubrics, ensemble or
panel multiple judges, force a refute-by-default stance, and keep a human or a ground-truth
reference for critical or ambiguous cases.

**Key sources.**
[Anthropic: Building a multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system),
[Why Do Multi-Agent LLM Systems Fail (MAST, arXiv 2503.13657)](https://arxiv.org/pdf/2503.13657),
[From Generation to Judgment: LLM-as-a-judge survey (arXiv 2411.16594)](https://arxiv.org/pdf/2411.16594),
[Don't Judge Code by Its Cover (arXiv 2505.16222)](https://arxiv.org/pdf/2505.16222).

**ADG actions.**
- Fan out only on genuinely independent work (per-surface gap hunts, per-INDEX-item builds).
  Keep dedup, the SQL backlog, the audit log, and final integration in the parent.
- Use an odd-sized judge panel with distinct lenses (correctness, measured token delta,
  response quality, best-practice and research alignment, guardrail integrity), randomised
  order, refute-by-default. Ship only on majority approval plus a measured win.
- Budget consciously: multi-agent is token-expensive, so reserve the swarm for breadth and
  verification, not for work a single bounded agent does as well.

## 4. Guardrails, policy-as-code, and toggleable controls

**What the research says.** Agent guardrails are moving from static roles to dynamic intent
checks evaluated at run time, expressed as policy-as-code (Open Policy Agent is the common
engine). Deterministic, deny-first enforcement (sandbox-exec wrappers, tool-eligibility
checks) is the reliable layer; model-side refusals are not. Mature designs support dynamic
toggles without redeploying: for example a single OPA Data API call can flip a maintenance
mode on or off instantly, and removing it restores normal access. Gartner projects 25% of
enterprise breaches by 2028 will trace to AI agent abuse, which is the business case for
hard controls. Meta's LlamaFirewall is an open guardrail framework worth studying as prior
art.

**Key sources.**
[Open Policy Agent as the guardrail for AI agents](https://codilime.com/blog/why-use-open-policy-agent-for-your-ai-agents/),
[Tool eligibility: deterministic guardrails](https://www.chenyezhu.com/writing/tool-eligibility-deterministic-guardrails-ai-agents/),
[LlamaFirewall (arXiv 2505.03574)](https://arxiv.org/pdf/2505.03574).

**ADG actions (the new toggleable-controls axis).**
- Model every guardrail and control as policy-as-code with an explicit enable/disable
  surface, scoped by risk class and context (lane, feature, host repo).
- Safe defaults: deny-by-default stays the default; a control can only be relaxed
  deliberately, never silently.
- Make toggling a first-class governed action: every enable/disable writes an audit
  decision event with reason, risk, and rollback, mirroring the existing waiver rule.
- Add negative tests proving a disabled control is logged and a re-enabled control blocks
  again. A control that can be turned off without a trace is a vulnerability, not a feature.

## 5. AI security and evals (keep the loop honest)

**What the research says.** Prompt injection is OWASP LLM01 for the third year running.
Indirect injection (malicious content arriving through a data channel) is now the majority
of incidents and has higher success rates than direct injection. Guardrails degrade under
long context, and in multi-agent pipelines a successful injection at one layer propagates to
every downstream layer. Defense is multi-layered (input screening, tool-eligibility,
output checks), not a single filter. Agent frameworks have shipped real RCE bugs where
prompts became shells.

**Key sources.**
[OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/),
[Prompt injection defense 2026 guide](https://www.getmaxim.ai/articles/prompt-injection-defense-for-production-ai-agents-a-complete-2026-guide/),
[Microsoft: when prompts become shells (RCE in agent frameworks)](https://www.microsoft.com/en-us/security/blog/2026/05/07/prompts-become-shells-rce-vulnerabilities-ai-agent-frameworks/).

**ADG actions.**
- Add or refresh eval scenarios for indirect injection and for the multi-agent propagation
  case, since the 1.0 loop itself is multi-agent.
- Treat content the agents read (research results, host files) as untrusted: the guardrail
  hook should fail closed for mutating tools even when context is adversarial.
- Keep the agent-evals gate in ci:governance and add a scenario whenever a control changes.

## 6. Top-labs quick scan

- **Anthropic:** context engineering, tool-writing, Claude Code subagents and skills,
  multi-agent research architecture, prompt caching. Primary source set for ADG's model.
  See the [2026 Agentic Coding Trends Report](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf).
- **OpenAI:** native JSON Schema structured outputs and automatic prompt caching (about 50%
  on cache hits) as platform defaults. Useful for the structured-output and caching axes.
- **Google DeepMind:** long-context and agentic Gemini work; relevant to context-budget
  trade-offs (more context is not automatically better).
- **Meta:** LlamaFirewall and open guardrail tooling; prior art for the toggleable-controls
  and security axes.

The live research swarm should pull each lab's most recent primary sources every loop and
flag anything that contradicts this brief.

## 7. What the live research swarm should chase each loop

1. Newer-than-this-brief primary sources from the four labs on context efficiency,
   structured outputs, judging, guardrails, and injection defense. Cite them.
2. Concrete, measured token-reduction techniques applicable to ADG's specific commands.
3. Evidence for or against each proposed change, so the judge panel has grounding beyond
   the model's own opinion.
4. Any security finding that would make a proposed toggleable control unsafe.

## 8. Open questions for the build

- Which ADG controls are safe to make toggleable, and which must stay always-on
  (audit append-only, destructive deny) regardless of config?
- What is the measured token cost of a full ci:governance run today, and where is the
  biggest reducible chunk?
- Can the MCP server, Claude adapter, Codex adapter, dashboard, and plugin share one
  install and one policy source without coupling that breaks clean-host adoption?

## Sources

- Anthropic: [Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- Anthropic: [Writing effective tools for AI agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- Anthropic: [Claude Code best practices](https://www.anthropic.com/engineering/claude-code-best-practices)
- Anthropic: [Building a multi-agent research system](https://www.anthropic.com/engineering/built-multi-agent-research-system)
- Anthropic: [2026 Agentic Coding Trends Report](https://resources.anthropic.com/hubfs/2026%20Agentic%20Coding%20Trends%20Report.pdf)
- arXiv 2503.13657: [Why Do Multi-Agent LLM Systems Fail? (MAST)](https://arxiv.org/pdf/2503.13657)
- arXiv 2411.16594: [From Generation to Judgment (LLM-as-a-judge survey)](https://arxiv.org/pdf/2411.16594)
- arXiv 2505.16222: [Don't Judge Code by Its Cover (judge bias in code)](https://arxiv.org/pdf/2505.16222)
- arXiv 2501.10868: [JSONSchemaBench (structured outputs)](https://arxiv.org/pdf/2501.10868)
- arXiv 2505.03574: [LlamaFirewall (Meta open guardrails)](https://arxiv.org/pdf/2505.03574)
- [OWASP Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [Prompt injection defense for production AI agents, 2026 guide](https://www.getmaxim.ai/articles/prompt-injection-defense-for-production-ai-agents-a-complete-2026-guide/)
- Microsoft Security: [When prompts become shells (RCE in agent frameworks)](https://www.microsoft.com/en-us/security/blog/2026/05/07/prompts-become-shells-rce-vulnerabilities-ai-agent-frameworks/)
- [Open Policy Agent as the missing guardrail for AI agents](https://codilime.com/blog/why-use-open-policy-agent-for-your-ai-agents/)
- [Tool eligibility: deterministic guardrails for production AI agents](https://www.chenyezhu.com/writing/tool-eligibility-deterministic-guardrails-ai-agents/)
- ProjectDiscovery: [How we cut LLM costs 59% with prompt caching](https://projectdiscovery.io/blog/how-we-cut-llm-cost-with-prompt-caching)
- Fable 5 / Mythos 5 suspension: [Anthropic statement](https://www.anthropic.com/news/fable-mythos-access), [Bloomberg](https://www.bloomberg.com/news/articles/2026-06-13/anthropic-says-us-limits-foreign-access-to-fable-5-mythos-5)

> Note on citations: a few 2026 arXiv preprints surfaced in search with very recent IDs
> that could not be fully verified at compile time. They are deliberately excluded from the
> claims above; the live research swarm should verify and add primary sources each loop.
