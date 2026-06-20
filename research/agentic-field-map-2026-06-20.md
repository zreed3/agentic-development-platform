# Agentic Field Map — mid-2026 refresh

*A current-state map of the agentic-AI / agent-loop design field across three
dimensions: top labs, top figures, and top GitHub repositories. Extends and refreshes
[`../loops-research.md`](../loops-research.md).*

**Date:** 2026-06-20 · **Method:** deep-research workflow (fan-out web search →
fetch → 3-vote adversarial verification → synthesis), supplemented by live GitHub API
star counts and targeted searches to close the workflow's self-flagged gaps.

**Confidence legend:**
- **[verified]** — 3-0 adversarial verification against a primary source.
- **[fresh]** — live-fetched this session (GitHub API / single-pass search);
  directional and current, but not adversarially verified.

---

## The one-line shift since the last synthesis

The field stopped inventing loop *algorithms* and started hardening loop *harnesses*.
The intellectual center of gravity moved to **context engineering**,
**evaluation / problem-definition**, and **durable state outside the context window**.
The live open dispute is **single-threaded vs. orchestrator-worker multi-agent**.
**[verified]**

---

## 1. Top labs & philosophies

| Lab | Philosophy | Most recent (last ~12mo) |
|---|---|---|
| **Anthropic** | Simplest composable pattern; context as engineered resource; ship a reusable harness | Canonical workflows-vs-agents taxonomy; long-running harness (initializer + coding agent, one feature at a time from a JSON list, `claude-progress.txt` + git for cross-session state); multi-agent Research system **[verified]** |
| **OpenAI** | Model-as-agent; minimal scaffolding | Agents SDK is now the **production successor to Swarm** (built-in loop, `max_turns` / `MaxTurnsExceeded` termination) **[verified]** |
| **Cognition** | Anti-multi-agent; single-threaded linear agents | "Don't Build Multi-Agents" (Walden Yan, Jun 2025): parallel subagents make conflicting implicit decisions; *share full traces, not messages* **[verified]** |
| **Google DeepMind** | Extend one model (Gemini) into autonomous action | Deep Research / **Deep Research Max** agents (`deep-research[-max]-preview-04-2026`, follow-ups via `gemini-3.1-pro-preview`); docs describe an autonomous `Plan→Search→Read→Iterate→Output` loop, "analyst-in-a-box"; agentic-vision Think-Act-Observe loop in Gemini 3 Flash **[verified]** (Gemini API primary) |
| **Microsoft** | Orchestrated multi-agent as structured conversation | **AutoGen → Microsoft Agent Framework** (shipping 2026, .NET + Python; sequential / concurrent / handoff / group-chat / Magentic-One patterns + durability / governance). Microsoft Learn calls it *"the direct successor... the next generation of both Semantic Kernel and AutoGen."* **AutoGen is now maintenance-mode**, the "innovation lab" only **[verified]** (successor status, Microsoft Learn primary) |
| **Meta FAIR** | Evaluation infrastructure as the lever | **ARE (Agents Research Environments)** + **Gaia2** benchmark — agents must handle ambiguity, dynamic environments, temporal constraints; co-author of original GAIA **[fresh]** |

**The live debate.** Anthropic's multi-agent Research system self-reports beating
single-agent Opus 4 by **90.2%** on its *internal* eval — not independently
reproduced, and Cognition's opposing post landed within ~24h. Treat 90.2% as a
self-reported figure, not a benchmark. The single-vs-multi-agent question is
unsettled, not a resolved best practice. **[verified]**

---

## 2. Top figures & load-bearing ideas

| Figure | Load-bearing idea | Recent |
|---|---|---|
| **Shunyu Yao** | ReAct (reasoning *as* action); **"The Second Half"** — one RL+reasoning recipe now generalizes; the bottleneck is now *defining & evaluating* problems, not capability | Essay Apr 2025 **[verified]** |
| **Noah Shinn** | **Reflexion** — verbal reinforcement learning: reflect on failure in language, store in episodic memory, retry, no weight updates (NeurIPS 2023) | Foundational prior **[verified]** |
| **Lilian Weng** | **Test-time compute** as a distinct scaling axis ("Why We Think", May 2025); CoT spends more FLOPs per answer token | **[verified]** |
| **Harrison Chase** | "Run the LLM in a loop" + **context engineering** as the umbrella; **framework vs. harness** layering (LangChain abstraction / LangGraph runtime / Deep Agents harness) | **[verified]** |
| **Andrej Karpathy** | **"Decade of agents"** (not year); **autonomy slider** — prefer partial-autonomy co-pilots, human in loop; Software 3.0 | YC keynote 2025, ongoing 2026 **[fresh]** |
| **Andrew Ng** | Four agentic design patterns (Reflection, Tool Use, Planning, Multi-Agent); a loop around a weaker model beats zero-shot from a stronger one | DeepLearning.AI Agentic AI course; "10-person teams" thesis 2026 **[fresh]** |

---

## 3. Top GitHub repositories — live star counts (GitHub API, 2026-06-20)

These counts and last-push dates were pulled fresh this session and supersede the
point-in-time numbers in `loops-research.md`.

| Repo | Stars | Last push | Loop topology | Termination | Memory model |
|---|---|---|---|---|---|
| **langchain** | 139.7k | 2026-06-20 | Framework (abstractions) | — | varies |
| **claude-code** | 133.4k | 2026-06-19 | gather→act→verify→repeat | per-iteration cap | compaction, subagents, CLAUDE.md, progress file |
| **codex** (OpenAI) | 92.2k | 2026-06-20 | tool-call→append→re-query | non-tool message | full history + compaction, AGENTS.md |
| **OpenHands** | 77.8k | 2026-06-19 | event stream (Action/Observation) | finish / max-iter / budget | event stream *is* state; condensers |
| **AutoGen** | 59.1k | 2026-04-15 | multi-agent conversation | termination conditions | shared conversation history |
| **crewAI** | 54.0k | 2026-06-20 | role-based crews | tasks done / `max_iter` | 4-layer memory |
| **aider** | 46.5k | 2026-05-22 | pair-programming; apply→lint→test→commit | turn-based | tree-sitter repo map (PageRank); git |
| **langgraph** | 35.2k | 2026-06-19 | cyclic StateGraph | `END` / conditional edge | typed state + checkpointers |
| **dspy** | 35.2k | 2026-06-18 | agents as compiled programs | `finish` / `max_iters` | per-run trajectory |
| **smolagents** | 27.9k | 2026-06-16 | minimal ReAct, **code-as-action** | `final_answer` / `max_steps` | editable step memory |
| **openai-agents-python** | 27.3k | 2026-06-19 | agent loop + handoffs | `MaxTurnsExceeded` | Sessions |
| **SWE-agent** | 19.6k | 2026-06-17 | ReAct via custom ACI | `submit` / cost cap | ACI-managed; sandbox |
| **pydantic-ai** | 17.9k | 2026-06-18 | typed FSM per run | validated typed output | typed graph state + history |

**Movements vs. the old doc:** vendor harnesses now dominate by stars
(claude-code 133k, codex 92k); OpenHands (~78k) is the top non-vendor harness;
AutoGen's 59k is now a **legacy** figure — the active line is Microsoft Agent
Framework. **[fresh]**

---

## Honest gaps & caveats

- **Confidence is uneven.** §1 (Anthropic / OpenAI / Cognition) and §2
  (Yao / Shinn / Weng / Chase) are 3-0 verified against primary sources. The
  **DeepMind** and **Microsoft** rows were additionally spot-checked against primary
  sources this session (Gemini API docs; Microsoft Learn) and so carry `[verified]`.
  The **Meta** row and the **Karpathy / Ng** rows remain single-pass `[fresh]`
  searches — current, but not adversarially verified. Star counts are hard
  (GitHub API).
- **90.2% multi-agent figure** is Anthropic's self-reported internal eval; do not
  cite as an objective benchmark.
- Two foundational Anthropic sources (*Building Effective Agents*, Dec 2024) predate
  the mid-2026 horizon by ~18 months — the architecture is stable, the numbers around
  it are not.

---

## Relation to the ADG framework

This maps cleanly onto the P1–P12 principles in `../loops-research.md`. The field's
2026 convergence — durable external state, hard caps + agent-decided "more work?",
context engineering — is exactly **P3 / P4 / P5**. The unsettled single-vs-multi-agent
axis is **P9**.

---

## Primary sources

**Labs**
- Anthropic, *Building Effective Agents* — https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, *Effective harnesses for long-running agents* — https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Anthropic, *Multi-agent research system* — https://www.anthropic.com/engineering/multi-agent-research-system
- Anthropic, *Effective context engineering for AI agents* — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- OpenAI Agents SDK — https://openai.github.io/openai-agents-python/
- Cognition, *Don't Build Multi-Agents* — https://cognition.ai/blog/dont-build-multi-agents
- Google, Gemini Deep Research API — https://ai.google.dev/gemini-api/docs/interactions/deep-research
- Microsoft Agent Framework — https://learn.microsoft.com/en-us/agent-framework/overview/
- Meta FAIR, ARE — https://ai.meta.com/research/publications/are-scaling-up-agent-environments-and-evaluations/

**Figures**
- Shunyu Yao, *The Second Half* — https://ysymyth.github.io/The-Second-Half/
- Noah Shinn, Reflexion — https://github.com/noahshinn/reflexion · https://arxiv.org/abs/2303.11366
- Lilian Weng, *Why We Think* — https://lilianweng.github.io/posts/2025-05-01-thinking/
- Harrison Chase (Sequoia) — https://sequoiacap.com/podcast/context-engineering-our-way-to-long-horizon-agents-langchains-harrison-chase/
- Andrej Karpathy, *Software Is Changing (Again)* — https://www.ycombinator.com/library/MW-andrej-karpathy-software-is-changing-again
- Andrew Ng, Agentic AI — https://www.deeplearning.ai/courses/agentic-ai

**Repositories** — star counts via GitHub API, 2026-06-20.

---

*Synthesis of public research as of June 2026. Claims tied to specific statistics or
closed-source internals should be re-verified against the primary source before being
relied upon for a decision.*
