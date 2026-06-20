# Agent Loops: A Principles Document and Guiding Framework

*A first-principles study of how autonomous LLM agents iterate — the labs and
researchers defining the field, the repositories implementing it, and a derived
framework for designing agent loops that converge, stay bounded, and produce
verifiable work.*

**Status:** research synthesis · **Date:** 2026-06-19 · **Scope:** the design of
the *loop* an LLM agent runs, not model training.

---

## 0. What this document is

An **agent loop** is the iterative cycle an LLM-based agent runs to accomplish a
goal: it perceives state, reasons about it, takes an action (usually a tool call),
observes the result, and repeats until the goal is met or a stop condition fires.

This document does three things:

1. **Maps the field** — the labs, researchers, papers, and repositories that define
   agent-loop design today, with primary sources.
2. **Extracts the design axes** — the small number of dimensions along which every
   real agent loop varies.
3. **Derives a framework** — a set of first-principles principles for designing
   agent loops, each justified from the underlying mechanics and stress-tested
   against failure modes, not asserted by authority.

The intended reader is someone building or governing an agentic system who needs a
defensible mental model rather than a framework tutorial.

---

## 1. First principles: what an agent loop *is*

Strip away the frameworks and an agent loop is five facts — four about the model and
the loop, and one (fact 5) that comes into force the moment the loop acts
autonomously in the world:

1. **An LLM is a stateless function.** It maps a context window to a next token.
   It has no memory between calls and no ability to act in the world on its own. Any
   "agent" is therefore *machinery wrapped around* this function.

2. **Agency is the act of feeding the model's own outputs — and the world's
   responses to them — back into its next input.** The loop *is* the agent. Remove
   the loop and you have a single completion.

3. **Every loop must answer four questions, or it fails.** These are not optional;
   they are forced by the structure:
   - **Context** — what goes into the window this iteration? (finite resource)
   - **Action** — what can the model *do*, and how is that expressed?
   - **Observation** — how does the result of acting re-enter the loop?
   - **Termination** — when, and on whose authority, does the loop stop?

4. **The model's recall degrades as its context fills.** Beyond a point, adding
   tokens *lowers* answer quality, not just cost — the empirically observed
   "context rot" effect (magnitude is model- and task-dependent; see §9). Pairwise
   attention also makes long context quadratically expensive in compute, but it is
   the *recall* degradation, not the FLOP cost, that binds design. So context is
   not free storage — it is an *attention budget* that must be spent deliberately.

5. **An agent that acts autonomously in the world must be governable.** The moment
   a loop takes real actions (fact 2) and feeds the world's responses back into its
   own input, three things become structurally true, independent of how capable the
   model is: (a) its behavior must be *bounded* (it can run forever or spend
   without limit), (b) it must be *reproducible and inspectable* (an opaque loop
   cannot be debugged, trusted, or governed), and (c) every observation it ingests
   is *untrusted input that can redirect a privileged action* (the injection
   surface is the feedback edge itself). Governability is not a preference layered
   on top — it is forced by the combination of autonomy and an open action space.

Everything below is downstream of these five facts. A good agent-loop design is a
coherent set of answers to the four questions in (3), respecting the recall
constraint in (4) and the governability constraint in (5).

### The canonical loop, in three vocabularies

The same cycle is named differently across the field; they are the same thing:

| Source | Formulation |
|---|---|
| Classical (Russell & Norvig; OODA; BDI) | perceive → decide → act → (observe) |
| ReAct (Yao et al., 2022) | **thought → action → observation**, interleaved |
| Anthropic (Claude Agent SDK, 2025) | **gather context → take action → verify work → repeat** |

The lineage matters: the LLM agent loop is not new in *shape*. OODA (Boyd),
BDI rational-agent theory, the SOAR cognitive architecture, and the perceive–act
loop of *AIMA* (1995) all describe the same cycle. What's new is that a single
pretrained model now fills the "reason" slot, and that the action space is
open-ended natural language and tool calls.

> Sources: ReAct https://arxiv.org/abs/2210.03629 · Anthropic, *Building Effective
> Agents* https://www.anthropic.com/engineering/building-effective-agents · Claude
> Agent SDK https://claude.com/blog/building-agents-with-the-claude-agent-sdk

---

## 2. The field: labs and their philosophies

Three philosophies emerge, distinguished by *where the loop lives*. The labels below
are illustrative leaders, not a clean partition — many systems (e.g. CrewAI,
LangGraph) blend camps.

### Camp A — Model-as-agent (loop trained into one model)

- **OpenAI** — bake tool-use and multi-step planning into the model itself
  (o-series models decide *when and how* to call tools and chain them in a single
  response). Operator / Computer-Using Agent operates a GUI from pixels. Production
  loop primitives: Responses API + Agents SDK (successor to the educational Swarm).
  *Philosophy: minimize bespoke scaffolding; the model is the agent.*
- **Google DeepMind** — extend one large model (Gemini) into action, and favor
  loops that **learn from self-generated experience** (SIMA 2 self-improves) or are
  **formally verified** (AlphaProof, with AlphaGeometry 2, writes Lean-checked
  proofs and reached silver-medal level at IMO 2024). *Philosophy: agency as emergent capability, grounded by verification.*
- **Cognition (Devin)** — end-to-end autonomy across "thousands of decisions,"
  holding context across a whole task and recovering from its own mistakes.
  *Philosophy: long-horizon autonomy.*

### Camp B — Orchestrated multi-agent (loop lives in a framework)

- **Microsoft Research** — autonomy as **structured conversation** between
  specialized conversable agents (AutoGen); an orchestrator plans, tracks progress
  via ledgers, and re-plans (Magentic-One). *Philosophy: decompose into talking
  specialists.*

### Camp C — Engineered single-agent + verified reasoning

- **Anthropic** — prefer the **simplest composable pattern**; treat context as a
  finite, engineered resource; ship a reusable **agent harness** (Claude Code,
  generalized into the Claude Agent SDK). Distinctive contributions: the
  workflows-vs-agents distinction, "context engineering" as a discipline, and the
  empirical result that orchestrator-worker multi-agent beat single-agent Opus 4 by
  **90.2%** on their research eval *at ~15× the token cost*. *Philosophy: add
  complexity only when it demonstrably improves outcomes.*

### Foundational, pre-product contributions

- **Meta AI (FAIR)** — Toolformer (self-supervised tool use); CICERO (explicit
  planning module grounding dialogue).
- **Stanford** — Generative Agents: the **memory-stream → reflection → planning**
  architecture (Park et al., UIST '23).
- **UC Berkeley** — Gorilla: tool/API calling as a *measurable skill* (Berkeley
  Function-Calling Leaderboard).

> Key sources: Anthropic multi-agent system https://www.anthropic.com/engineering/multi-agent-research-system
> · OpenAI Operator https://openai.com/index/introducing-operator/ · AutoGen
> https://www.microsoft.com/en-us/research/publication/autogen-enabling-next-gen-llm-applications-via-multi-agent-conversation-framework/
> · AlphaProof https://deepmind.google/blog/ai-solves-imo-problems-at-silver-medal-level/
> · Generative Agents https://arxiv.org/abs/2304.03442 · Gorilla https://arxiv.org/abs/2305.15334

---

## 3. The field: researchers and their load-bearing ideas

| Researcher | Idea that matters for loop design |
|---|---|
| **Shunyu Yao** (ReAct, Tree of Thoughts, SWE-bench) | Interleaving reasoning with action grounds the model in observations and cuts hallucination. His "Second Half" thesis: *evaluation/task design is now the bottleneck, not capability.* |
| **Noah Shinn** (Reflexion) | "Verbal reinforcement learning": reflect on failure in natural language, store it in episodic memory, retry. Learning without gradient updates. |
| **Jim Fan / Guanzhi Wang** (Voyager, Eureka) | A persistent **skill library** + **automatic curriculum** lets an agent compound competence across a long run. |
| **Lilian Weng** | The canonical synthesis: **Agent = LLM + Planning + Memory + Tool Use.** |
| **Harrison Chase** (LangChain) | The "cognitive architecture" spectrum — autonomy is a continuum from a single LLM call to a fully autonomous agent. |
| **Andrew Ng** | Four agentic design patterns — **Reflection, Tool Use, Planning, Multi-Agent**. Load-bearing claim: *an agentic loop around a weaker model can beat a single zero-shot pass from a stronger one* — progress lives in the loop. |
| **Andrej Karpathy / Tobi Lütke** | "Context engineering" — filling the window with *just the right* information for the next step. Plus the **autonomy slider**: prefer partial-autonomy co-pilots; keep AI "on a leash" because of the demo-to-product reliability gap. |

> Sources: Reflexion https://arxiv.org/abs/2303.11366 · Voyager https://arxiv.org/abs/2305.16291
> · Weng, *LLM Powered Autonomous Agents* https://lilianweng.github.io/posts/2023-06-23-agent/
> · Ng, *The Batch* https://www.deeplearning.ai/the-batch/ · Yao, *The Second Half*
> https://ysymyth.github.io/The-Second-Half/

---

## 4. The field: foundational patterns

The named patterns are best read as answers to the four forced questions of §1.

**Reasoning substrate (improves the "reason" slot):**
- **Chain-of-Thought** — exemplars of intermediate steps induce step-by-step
  reasoning; emergent at scale. (https://arxiv.org/abs/2201.11903)
- **Self-Consistency** — sample diverse reasoning paths, majority-vote the answer.
  (https://arxiv.org/abs/2203.11171)

**The core loop:**
- **ReAct** — interleave thought / action / observation; ground reasoning in the
  environment. (https://arxiv.org/abs/2210.03629)
- **Reflexion** — add a self-critique + episodic-memory feedback edge to the loop.
  (https://arxiv.org/abs/2303.11366)

**Search over the loop:**
- **Tree of Thoughts** — branch candidate thoughts, self-evaluate, backtrack
  (BFS/DFS). Game of 24: 74% vs CoT's 4%. (https://arxiv.org/abs/2305.10601)

**Tool use & embodiment:**
- **Toolformer** — keep an API call only if it lowers next-token loss → self-labeled
  tool-use data. (https://arxiv.org/abs/2302.04761)
- **Voyager** — auto-curriculum + executable skill library + self-verification; no
  gradient updates. (https://arxiv.org/abs/2305.16291)

**Plan-then-execute vs. interleaved:**
- **Plan-and-Solve / Plan-and-Execute** — devise a full plan, then execute, vs.
  ReAct's step-by-step interleaving. The central topology choice. (https://arxiv.org/abs/2305.04091)

**Composite orchestration patterns (Anthropic's taxonomy):**
- **Evaluator-optimizer** — generator LLM + evaluator LLM in a feedback loop; use
  when criteria are clear and iteration measurably helps.
- **Orchestrator-workers** — a central LLM *dynamically* decomposes a task,
  delegates to workers, synthesizes results (subtasks not predefined).

---

## 5. The field: repositories and how they answer the four questions

A condensed survey of the highest-signal implementations. Star counts are
point-in-time (mid-2026) and drift.

### Orchestration frameworks

| Framework | Loop topology | Termination | Memory/state | Stars |
|---|---|---|---|---|
| **LangGraph** | Cyclic **StateGraph** (nodes/edges, conditional routing) | `END` node / conditional edge | Typed state + **checkpointers** (resume, HITL, time-travel) | ~35k |
| **Microsoft AutoGen** | Multi-agent **conversation**; v0.4 = async actor model | Termination conditions (max messages, text mention) | Shared conversation history; per-agent context | ~59k |
| **CrewAI** | Role-based **crews**; sequential or hierarchical | All tasks done; per-agent `max_iter` | 4-layer (short/long/entity/contextual) | ~54k |
| **OpenAI Agents SDK** (← Swarm) | **Agent loop + handoffs** | `MaxTurnsExceeded` | Sessions (Swarm was deliberately stateless) | ~27k |
| **HuggingFace smolagents** | Minimal ReAct; **CodeAgent writes actions as Python** | `final_answer` / `max_steps` | Editable execution-step memory | ~28k |
| **DSPy** | Agents as **programs** + compile-time optimizers | `finish` / `max_iters` (default 10) | Per-run trajectory | ~35k |
| **Pydantic AI** | Each run is a **typed FSM** | Validated typed output | Typed graph state + history | ~18k |

### Autonomous projects & coding harnesses

| Project | Loop | Termination | Memory | Stars |
|---|---|---|---|---|
| **AutoGPT** | Self-prompting reason-act; one command/cycle | `task_complete` / continuous-limit | Short buffer + external; *dropped vector DBs as overkill* | ~185k |
| **BabyAGI** | ~100-line three-agent task-queue loop | Until queue empty (no convergence guarantee) | Vector store + task queue | ~22k |
| **Aider** | Human-in-loop pair-programming; apply→lint→test→**auto-commit to git** | Turn-based | **Tree-sitter repo map ranked by PageRank**; durable state in **git** | ~47k |
| **OpenHands** | **Event stream** of Actions/Observations; agent = pure fn(history)→action | finish / max-iterations / budget | Event stream *is* the state; condensers summarize | ~78k |
| **SWE-agent** | ReAct via a custom **Agent-Computer Interface (ACI)** | `submit` / cost cap | History managed by ACI; sandbox checkout | ~20k |
| **Claude Code / Agent SDK** | gather→act→verify→repeat | per-iteration | **Compaction**, sub-agents w/ isolated context, CLAUDE.md steering | ~133k |
| **OpenAI Codex** | tool-call → append → re-query until assistant message | turn ends on non-tool message | full history + compaction; **AGENTS.md** | ~92k |

### The Ralph loop (brute-force restart)

Geoffrey Huntley's **Ralph** is the instructive extreme. Its canonical form:

```bash
while :; do cat PROMPT.md | claude-code ; done
```

- **One item per loop.** Each iteration is a **fresh agent with a clean context
  window** — nothing carries in-context.
- **Memory = filesystem + git**, not context. `PROMPT.md` (re-read every loop),
  `fix_plan.md`, `specs/`, `AGENTS.md`, and git history *are* the durable state; the
  stateless agent re-derives state from disk each iteration.
- **Termination is external.** The pure form does not self-terminate; stopping is
  delegated to tests/build passing + commit, not the model's self-judgment.
- **Stated tradeoff:** *"deterministically bad in an undeterministic world… better
  to fail predictably than succeed unpredictably."* It trades context accumulation
  (and context rot) for stateless restart and eventual consistency.

Ralph is valuable precisely because it isolates the four questions: it pushes
*memory* entirely onto the filesystem and *termination* entirely onto external
verification, proving both can live outside the model.

> Sources: Ralph https://ghuntley.com/ralph/ · snarktank/ralph https://github.com/snarktank/ralph
> · LangGraph https://github.com/langchain-ai/langgraph · OpenHands https://github.com/All-Hands-AI/OpenHands
> · SWE-agent (ACI) https://arxiv.org/abs/2405.15793 · CodeAct https://arxiv.org/abs/2402.01030

---

## 6. The five design axes

Across 25+ systems, loop design varies along five axes plus one cross-cutting
concern (the agent-computer interface). Three axes are the direct practical form of
the forced questions of §1 (action → Q2, observation → Q3, termination → Q4); two
more — **loop topology** (control flow) and **memory/state** — are dimensions the
four questions don't name but every real system must decide, with memory/state
being the durable counterpart to the volatile per-iteration *context* (Q1). Listing
them is the point: the four questions are necessary but not a complete design
surface.

1. **Loop topology** *(answers: how does control flow?)*
   Hidden while-loop (AutoGPT, Codex) → explicit graph/FSM (LangGraph, Pydantic AI)
   → conversation (AutoGen) → external process restart (Ralph). Graphs trade
   simplicity for inspectability and control.

2. **Action space** *(answers: what can it do?)*
   JSON/text tool calls vs. **executable code as the action** (CodeAct: OpenHands,
   smolagents — ~+20% success in the CodeAct paper). Code composes and self-debugs
   better but requires sandboxing.

3. **Observation & error handling** *(answers: how do results re-enter?)*
   The strongest systems feed errors back **as observations the model must react
   to** (smolagents stores errors in memory; OpenHands reads real stack traces;
   Aider feeds lint/test failures back). Errors are signal, not exceptions to
   swallow.

4. **Termination** *(answers: when, and on whose authority, does it stop?)*
   The most common failure mode is **non-termination**. Every mature system imposes
   a hard stop (max iterations / turns / budget) *and* most gate *success* on
   **external verification** (tests/lint/build) rather than the model's
   self-assessment — though as model self-evaluation improves, that balance is
   shifting (see §9). The hard cost-bound remains necessary regardless.

5. **Memory / state** *(answers: what persists across iterations?)*
   In-context history → compaction/summarization (Claude Code, Codex) →
   externalized to **filesystem + git** (Aider, Ralph, GPT-Engineer) → vector stores
   (early autonomous agents — *a trend that has receded*). Strongest signal: **the
   filesystem and git are the most durable agent memory**, and fresh-context restart
   can beat context accumulation.

A cross-cutting concern governs all five axes:

6. **Interface engineering (the ACI).** SWE-agent's thesis — *the agent-computer
   interface drives performance more than the model* — generalizes. Token-bounded
   context (Aider's PageRank repo map; sub-agent isolation returning ~1–2k-token
   summaries) is the highest-leverage, least-obvious lever.

---

## 7. The guiding framework: principles for designing agent loops

Each principle is stated, then traced to §1 first principles, then given an
**implication** and a **failure mode it prevents**. They are ordered from most to
least fundamental. An honesty note on method: principles P1, P3, P4, P5, P6, P8 are
**mechanical derivations** from facts 1–4 (the model and the loop). P2, P7, P9, P10,
P11, P12 additionally require **fact 5 (governability)** — the premise that an
autonomous actor must be bounded, reproducible, and constrained. Where a principle
leans on an empirical result rather than a derivation, it is labeled as such, not
dressed up as one.

### P1 — The loop is the product; the model is a component.
**Derivation:** the LLM is a stateless function (fact 1); all capability gain
beyond a single completion comes from how outputs and observations are fed back
(fact 2). Ng's result — an agentic loop around a weaker model beats zero-shot from a
stronger one — is the empirical confirmation.
**Implication:** invest design effort in the loop (context, actions, observations,
termination), not only in model selection.
**Prevents:** "we'll fix it with a bigger model" — which leaves the four questions
unanswered.

### P2 — Choose the least autonomy that solves the problem.
**Derivation:** each added degree of freedom multiplies the state space the loop can
wander into, and a larger state space is harder to bound and inspect — which fact 5
(governability) says we must do. Predefined code paths (*workflows*) are inspectable
and bounded; dynamic self-direction (*agents*) is flexible but harder to govern. The
autonomy-as-continuum framing (Chase, Karpathy) is the field's name for this dial.
**Implication:** prefer a fixed workflow (prompt chain, routing, parallelization)
until a task genuinely needs the model to direct its own steps. Anthropic's rule —
*add complexity only when it demonstrably improves outcomes* — restated.
**Prevents:** unnecessary non-determinism, runaway cost, and unauditable behavior.

### P3 — Every loop must have a hard stop *and* an authority for success.
**Derivation:** an LLM cannot reliably judge its own completion (it is the thing
being judged), and a loop with no termination is a non-terminating program (fact 3,
termination). Two distinct concerns: *bounding cost* and *deciding done*.
**Implication:** always set a max-iteration / turn / budget cap (bounds cost), and
gate *success* on an **external verifier** — tests, type-check, build, a linter,
a measured metric — not the model's self-report. SWE-agent's linter, Ralph's
test-gated commit, and Aider's lint+test loop all do this.
**Prevents:** infinite loops, premature "done," and confidently-wrong completions.

### P4 — Treat context as a finite attention budget, not storage.
**Derivation:** attention is n² and recall degrades as the window fills (fact 4,
"context rot"). More context is not monotonically better.
**Implication:** curate the smallest high-signal set of tokens per iteration.
Use compaction (summarize history, keep the few most-recent artifacts), sub-agents
with isolated context returning short summaries, and a generated context packet
*before* opening source files. Watch for the four context failure modes —
poisoning, distraction, confusion, clash.
**Prevents:** degraded reasoning, cost blowup, and the agent losing the plot in a
long run.

### P5 — Externalize durable state to the filesystem and version control.
**Derivation:** context is volatile and bounded (P4); anything that must survive
across iterations or a context reset cannot live only in the window.
**Implication:** write plans, specs, learnings, and results to files; let git be
the memory and the undo. This is what makes fresh-context restart (Ralph) viable
and what lets Aider/OpenHands recover. Note the receding of vector stores — AutoGPT
dropped them as overkill; the filesystem is usually enough.
**Prevents:** state loss on compaction/restart, irreproducible runs, and the
inability to roll back.

### P6 — Ground every iteration in real observation.
**Derivation:** reasoning unanchored from the environment hallucinates; ReAct's core
result is that interleaving action and observation reduces this.
**Implication:** prefer real tool results, code execution, and measured outcomes
over the model's predictions of what *would* happen. Feed errors back as
first-class observations the model must address (axis 3). Verify with ground truth,
not assertion.
**Prevents:** compounding hallucination and plausible-but-wrong trajectories.

### P7 — Make the loop transparent and the interface agent-shaped.
**Derivation:** two threads. Transparency is forced by fact 5(b) — a loop that acts
autonomously must be inspectable to be governed. Interface quality is an *empirical*
finding: SWE-agent shows the ACI drives performance more than the model (cited as
evidence, not derived). Together: a loop must be both legible *and* shaped for the
model that drives it.
**Implication:** show the plan and the steps; design tools and their outputs *for
the model* (clear names, bounded outputs, code-as-action where it composes better);
keep the trajectory inspectable. The agent-computer interface deserves as much
design care as a human UI.
**Prevents:** silent failure, untraceable bugs, and tool-misuse loops.

### P8 — Add error recovery as a loop edge, not an afterthought.
**Derivation:** in a multi-step loop (facts 2–3), an unhandled error either halts
progress or compounds into later iterations — this follows directly from the
feedback structure. *Empirical confirmation:* Reflexion shows that reflecting on
failure and retrying is itself a learnable capability.
**Implication:** failed checks should create **backpressure** — block the commit,
return the error as an observation, and let the next iteration fix it (Ralph, Aider,
smolagents). Bound retries so recovery doesn't become its own infinite loop.
**Prevents:** broken work compounding across iterations, and brittle halt-on-first-
error behavior.

### P9 — Reach for multi-agent only when isolation pays for itself.
**Derivation:** context isolation follows from fact 4 — each sub-agent gets a fresh,
uncontended attention budget, which is the structural benefit; parallelism is an
independent operational gain. Both cost coordination overhead and tokens.
*Empirical confirmation:* Anthropic's orchestrator-worker beat single-agent by 90.2%
at ~15× the tokens — the shape of the tradeoff, not a guaranteed magnitude.
**Implication:** use sub-agents for read-heavy, parallelizable, or
context-isolating work (exploration, review, triage) where each can return a short
summary. Keep shared mutable state (the backlog, the audit log, final integration)
in a single coordinating agent.
**Prevents:** token blowup, race conditions on shared state, and coordination
complexity that exceeds the benefit.

### P10 — Prefer predictable failure to unpredictable success.
**Derivation:** fact 5(b) requires reproducibility; a loop you can reason about,
reproduce, and bound is governable, while one that occasionally succeeds in
unrepeatable ways is not — even if its peak performance is higher. Huntley's Ralph
maxim — *deterministically bad beats undeterministically good* — is the field's
statement of this. (This is a design value, made legitimate by fact 5, not a
mechanical consequence of facts 1–4 alone.)
**Implication:** favor designs whose failure modes are legible and recoverable
(hard caps, external verification, externalized state, fresh restarts) over clever
designs that maximize peak performance at the cost of predictability.
**Prevents:** un-debuggable, un-governable systems that work until they don't.

### P11 — Bound the action space by blast radius; treat every observation as untrusted.
**Derivation:** fact 5(c). The instant a loop both takes privileged actions and
feeds the world's responses back into its own input, untrusted-input-to-privileged-
action is structural, not a bug: a tool result, web page, or file the agent reads
can carry instructions (prompt injection), and a single wrong action can be
irreversible (deleted data, leaked secrets, money moved). The very feedback edge
that creates agency (P6) is also the attack surface.
**Implication:** scope the action space to the least privilege that solves the task;
gate irreversible or sensitive actions (deletion, spend, production, secrets) behind
explicit confirmation or deny-by-default policy; sandbox code execution; and never
let an instruction *arriving in an observation* silently escalate what the loop is
allowed to do. Risk-class the tools, don't trust the trajectory.
**Prevents:** prompt-injection hijacking, irreversible damage, and data exfiltration
through the observation channel.

### P12 — Design the success criterion before the loop; evaluation is the bottleneck.
**Derivation:** facts 3 (termination needs an *authority* for "done") and 5(b)
(reproducibility) both require a criterion external to the model. Yao's "Second
Half" thesis sharpens this empirically: capability has outrun our ability to
*specify and measure* tasks, so the task spec and its evaluator are now the scarce
work, not the model.
**Implication:** write the acceptance criterion / eval *first*; make it the same
external verifier that gates success (P3); maintain a held-out eval for the loop
itself, not just per-run checks. A loop optimizes toward whatever you can measure —
so the measure is a design artifact, not an afterthought.
**Prevents:** loops that converge confidently on the wrong target, and "it works"
claims with no reproducible standard behind them.

---

## 8. Quick-reference: designing a new agent loop

A checklist derived from §7. (P1 — *the loop is the product* — is the framing
principle behind the whole list, not a single item.) For any loop you build, answer:

- [ ] **Autonomy** — is this a *workflow* (predefined paths) or a true *agent*
      (self-directed)? Have you chosen the least autonomy that works? *(P2)*
- [ ] **Context** — what is the minimal high-signal context per iteration? How is it
      compacted as the run grows? *(P4)*
- [ ] **Action space** — JSON tool calls or executable code? Are tools designed for
      the model and sandboxed if code runs? *(P7, axis 2)*
- [ ] **Observation** — are results (including errors) fed back as observations the
      model must react to? *(P6, P8)*
- [ ] **Termination — bound** — what is the hard cap (iterations / turns / budget)?
      *(P3)*
- [ ] **Termination — success** — what *external verifier* (tests / build / metric)
      decides "done," instead of the model's self-report? *(P3)*
- [ ] **State** — what persists to the filesystem / git across iterations and
      resets? *(P5)*
- [ ] **Recovery** — what happens on a failed step? Is there backpressure and a
      retry bound? *(P8)*
- [ ] **Topology** — hidden loop, explicit graph, conversation, or restart? Is it
      inspectable? *(P7, axis 1)*
- [ ] **Safety / blast radius** — is the action space least-privilege? Are
      irreversible/sensitive actions gated, code sandboxed, and observations treated
      as untrusted input? *(P11)*
- [ ] **Success criterion** — is the eval/acceptance spec written *before* the loop,
      and is it the same external verifier that gates "done"? *(P12, P3)*
- [ ] **Failure legibility** — are this loop's failure modes reproducible and
      bounded, rather than clever-but-unrepeatable? *(P10)*
- [ ] **Multi-agent?** — only if isolation/parallelism pays for the token and
      coordination cost. *(P9)*

---

## 9. Open questions and uncertainty

Flagged so the framework isn't over-trusted:

- **"Context rot" magnitude is model- and task-dependent.** Fact 4 (and P4/P5,
  which lean on it) treats recall degradation as load-bearing. The effect is
  empirically observed but its strength varies by model and task, and long-context
  techniques keep shifting the frontier; treat F4 as a strong default, not a
  constant.
- **Termination by self-judgment is improving.** P3's "never trust the model to
  decide done" is a 2024–2025 truth; as models get better at calibrated
  self-evaluation, the balance between external verification and self-assessment may
  shift. The cost-bound (hard cap) will remain regardless.
- **Vector-store memory has receded but not vanished.** The filesystem-first finding
  (P5) holds for coding agents; retrieval-heavy domains may still need vector memory.
- **Code-as-action's ~+20% advantage** is from the CodeAct paper's benchmarks; the
  margin is task-dependent and requires a sandbox, which not every environment has.
- **Star counts, iteration-cap defaults, and closed-source internals** (Cursor,
  Devin) in §5 are point-in-time or third-party; re-verify before citing as hard
  numbers.
- **Multi-agent's 90.2% / 15× figures** are from one lab's one eval; the *shape* of
  the tradeoff generalizes, the magnitudes do not.

---

## 10. Primary sources

**Definitional / industry guidance**
- Anthropic, *Building Effective Agents* — https://www.anthropic.com/engineering/building-effective-agents
- Anthropic, *Effective context engineering for AI agents* — https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Anthropic, *Building agents with the Claude Agent SDK* — https://claude.com/blog/building-agents-with-the-claude-agent-sdk
- Anthropic, *Multi-agent research system* — https://www.anthropic.com/engineering/multi-agent-research-system
- Lilian Weng, *LLM Powered Autonomous Agents* — https://lilianweng.github.io/posts/2023-06-23-agent/
- Andrew Ng, *The Batch* (agentic design patterns) — https://www.deeplearning.ai/the-batch/
- Shunyu Yao, *The Second Half* — https://ysymyth.github.io/The-Second-Half/

**Foundational papers**
- ReAct — https://arxiv.org/abs/2210.03629
- Reflexion — https://arxiv.org/abs/2303.11366
- Tree of Thoughts — https://arxiv.org/abs/2305.10601
- Chain-of-Thought — https://arxiv.org/abs/2201.11903
- Self-Consistency — https://arxiv.org/abs/2203.11171
- Toolformer — https://arxiv.org/abs/2302.04761
- Voyager — https://arxiv.org/abs/2305.16291
- Plan-and-Solve — https://arxiv.org/abs/2305.04091
- Generative Agents — https://arxiv.org/abs/2304.03442
- Gorilla — https://arxiv.org/abs/2305.15334
- CodeAct — https://arxiv.org/abs/2402.01030
- SWE-agent (ACI) — https://arxiv.org/abs/2405.15793

**Repositories & practitioner sources**
- LangGraph — https://github.com/langchain-ai/langgraph
- Microsoft AutoGen — https://github.com/microsoft/autogen
- CrewAI — https://github.com/crewAIInc/crewAI
- OpenAI Agents SDK — https://openai.github.io/openai-agents-python/ · Swarm — https://github.com/openai/swarm
- HuggingFace smolagents — https://github.com/huggingface/smolagents
- DSPy — https://github.com/stanfordnlp/dspy
- AutoGPT — https://github.com/Significant-Gravitas/AutoGPT
- Aider — https://github.com/Aider-AI/aider
- OpenHands — https://github.com/All-Hands-AI/OpenHands
- SWE-agent — https://github.com/princeton-nlp/SWE-agent
- Claude Code — https://github.com/anthropics/claude-code
- OpenAI Codex — https://github.com/openai/codex
- Ralph — https://ghuntley.com/ralph/ · snarktank/ralph — https://github.com/snarktank/ralph

---

*This document is a synthesis of public research as of June 2026. Claims tied to
specific statistics or closed-source internals should be re-verified against the
primary source before being relied upon for a decision.*
