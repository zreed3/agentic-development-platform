# Agent Setup Guide — paste this into an agent to set ADG up for you

*A self-contained runbook for an AI coding agent (Claude Code, Codex, or any
tool-using agent) to set up the Agentic Development Governance (ADG) platform —
either to evaluate ADG itself, or to install it into your own repo — and then
operate inside its rules.*

**How to use this:** open a fresh agent session in the target repository and paste
**everything below the line** as your prompt. The agent works top to bottom, runs
the commands, verifies each step against a real check, and reports what passed and
what could not run. Every command below is real and maps to a `package.json`
script — the agent should not invent flags or commands. If a command is missing,
the agent is in the wrong directory or ADG is not installed yet.

> Scope note: ADG's core needs only **Node ≥ 20** and the **`sqlite3` CLI** — no
> runtime dependencies, no SaaS, no API keys. `npm install` is **optional** and only
> needed for the governance MCP server. Keep concrete model IDs out of docs; ADG
> selects an *abstract capability tier* and resolves it to a provider model in the
> single editable file `config/agentic/models.json`.

---

## ROLE

You are an automation agent setting up ADG. Be deterministic and honest: run the
real command, read its real output, and report ground truth (passed / failed /
could-not-run). Never weaken a policy or hand-edit a generated artifact to make a
check pass. If a gate fails, surface the failure with its output — do not paper
over it.

## STEP 0 — Prerequisites (verify before doing anything)

Run and confirm each; if any is missing, stop and report exactly which one:

```sh
node -v            # must be >= 20
sqlite3 --version  # the sqlite3 CLI must be on PATH
git --version      # needed for the audit chain and the doctor's git checks
```

Then decide which path you are on:

- **Path A — Evaluate ADG itself.** You are inside a clone/checkout of the ADG
  repository (you can see `package.json` with an `agentic-development-governance`
  name, plus `loops-research.md` and `config/agentic/`). Go to **Step A**.
- **Path B — Install ADG into this repo (adoption).** You are inside *your own*
  project and want ADG's governance layer added to it. Go to **Step B**.

If unsure, run `cat package.json | grep '"name"'` — if it reads
`agentic-development-governance` you are in the ADG repo (Path A). Trust the package
name, not the directory: the repo *folder* may be named differently (e.g.
`agentic-development-platform`).

---

## STEP A — Get the ADG repo running and prove it works

1. **Build the data layer.** Choose one:

   ```sh
   npm run setup        # clean install: builds an EMPTY data/backlog.sqlite from schema + empty seed
   npm run setup:demo   # optional: load the self-referential ADG worked example (+ mirrors the audit log to SQL)
   ```

   The generated `data/*.sqlite` files are gitignored; they are rebuilt from the
   seed, never hand-edited.

2. **(Optional) Install the one dependency** — only if you want the governance MCP
   server (`npm run adg:mcp`). Everything else runs without it:

   ```sh
   npm install   # installs @modelcontextprotocol/sdk, used ONLY by the MCP server
   ```

3. **Prove it works with the full gate** (this is the authoritative end-to-end
   verifier; it internally re-runs `setup:demo`, then the backlog/audit/guardrail/
   asset/eval/metrics/elicitation/context/ux/standards/deliverable/plugin/maturity/
   skills validators, the full tooling test suite, `adg:doctor`, and finally the
   install/hook/codex/mcp test suites):

   ```sh
   npm run ci:governance   # expect EXIT 0; report any FAIL/Error line verbatim
   npm run adg:doctor      # conformance doctor on this repo; expect "conformant", 6/6 checks
   ```

4. **Try the everyday surfaces** so you understand what you installed:

   ```sh
   npm run work:classify -- --intent "small css spacing fix" --file docs/setup.html
   npm run models:tiers
   npm run context:slice -- --feature S07 --workflow agentic-tooling
   ```

5. **Report.** State: prerequisites OK, which setup you ran, the `ci:governance`
   exit code, the doctor result, and anything that could not run (e.g. the Rust
   `asset:lint` helper skips green if not built — that is expected).

---

## STEP B — Install ADG into your repo (adoption)

You run the installer **from an ADG checkout**, pointing it at your repo with
`--target`. (Clone ADG somewhere first if you have not.) `--target` defaults to the
current directory when omitted.

### B1 — Fastest: zero-onboarding init

```sh
npm run adg:init -- --target /path/to/your/repo --client claude --dry-run
```

`adg:init` is non-interactive. It (1) auto-detects the host client (`claude` if
`.claude/` or `CLAUDE.md` exists; `codex` if `.codex/` or `AGENTS.md` exists; both →
`both`; otherwise defaults to `claude`), (2) delegates to the installer, then (3)
runs **one real work-classification on your pending git diff** as a value proof, and
(4) prints next steps. Accepted flags: `--target DIR`, `--client claude|codex|both`,
`--dry-run`. Drop `--dry-run` to actually write.

### B2 — Explicit install (full control)

```sh
# Preview first (no writes):
npm run adg:install -- --target /path/to/your/repo --client both --dry-run

# Then install for real (add --dashboard on for the read-only governance UI):
npm run adg:install -- --target /path/to/your/repo --client both --dashboard on
```

**`--client` accepts `base | claude | codex | both`** (an unsupported value errors
out). Other flags: `--dashboard on|off`, `--dry-run`, `--force`, `--force-scripts`,
`--force-policy` (re-baseline `guardrails.json` to ADG's source instead of merging),
`--format json`.

**What gets written into your repo:**

| Layer | Installed for | Lands as |
|---|---|---|
| **Base lane guard** | always | `config/agentic/delivery-lanes.json`, `scripts/adg-work-classify.mjs`, the Proofline docs, and the `adg:classify` / `adg:guard` / `adg:prepush` package scripts |
| **Shared enforcement** | any `--client` | the deterministic PreToolUse guardrail hook (`scripts/adg-guardrail-hook.mjs`), the single policy source `config/agentic/guardrails.json` (merge-managed), `guardrail-check` / toggle / audit-chain / record-audit / validate-audit / doctor, and the `asset:lint` gate |
| **Claude layer** (`claude`/`both`) | Claude hosts | `.claude/settings.json` (hook registration + deny-by-default permissions), ADG slash commands in `.claude/commands/` (e.g. `/adg-classify`, `/adg-context`, `/adg-verify`, `/adg-completeness-critic`), and a `CLAUDE.md` generated from your `AGENTS.md` (skipped if you have no `AGENTS.md`) |
| **Codex layer** (`codex`/`both`) | Codex hosts | the harness-neutral Codex pre-tool adapter (`scripts/adg-codex-pretool.mjs`) delegating to the same hook |
| **Dashboard** (`--dashboard on`) | optional | the read-only SvelteKit UI at `apps/adg-dashboard/` + an `adg:dashboard` script (its deps install under that folder; nothing is added to your root dependency tree) |

The install is recorded in `config/agentic/adg-install-state.json` (managed files +
sha256 + chosen client/dashboard), so updates are versioned and reversible.

### B3 — Verify the install

```sh
npm run adg:doctor -- --target /path/to/your/repo          # expect "conformant" (warns, doesn't fail, on a non-git target)
npm run adg:install:status -- --target /path/to/your/repo  # per-file state + doctor; exits non-zero on drift
```

### B4 — Update later (safe refresh)

```sh
npm run adg:update -- --target /path/to/your/repo          # refresh managed files
npm run adg:update -- --target /path/to/your/repo --dashboard off   # also prune the dashboard
```

`adg:update` **preserves your governed toggle state** when refreshing
`guardrails.json` and **forces the three always-on controls back on** — a relaxed
always-on control can never be carried forward.

---

## STEP C — Configure (policy-as-code in `config/agentic/`)

Edit these files, **not** the scripts. They are the governance dials:

| File | Governs |
|---|---|
| `guardrails.json` | deny-by-default risk classes + toggleable controls (3 pinned always-on) |
| `loop-budget.json` | loop governor caps (`maxTurns`/`maxToolCalls`), release-gate mode, subagent fan-out caps |
| `models.json` | abstract capability tier → provider model — the *only* place model IDs live |
| `context-profiles.yaml` | per-workflow context budgets |
| `delivery-lanes.json` | the L0–L4 Proofline lanes |

**Never hand-edit a control to relax it** — the runtime ignores the edit
(fail-closed) and the gate rejects it. The only supported way to disable a
toggleable control is the audited path:

```sh
npm run guardrails:toggle -- --control <name> --set off --reason "..." --risk "..." --rollback "..."
```

This refuses the always-on controls (`destructiveDeny`, `auditAppendOnly`,
`forbiddenBulkRead`) and writes an append-only audit `decision` event.

---

## STEP D — Optional surfaces

- **Governance MCP server** (`npm run adg:mcp`, needs `npm install`): a stdio MCP
  server exposing **four** tools — `classify_work` (read-only), `context_packet`
  (read-only), `control_state` (read-only), and `record_audit` (append-only; it
  refuses likely-secret material). Point any MCP client at it for one shared
  implementation of classification / context / audit.
- **Read-only dashboard:** `npm run dashboard:dev` (or `dashboard:build`,
  `dashboard:docker`) in the ADG repo, or `--dashboard on` at install time for your
  host. SvelteKit, no auth, reads the repo's `data/` and `config/agentic/` directly.
- **Model orchestrator:** `npm run models:tiers` shows the abstract ladder
  (`economy < fast-reasoning < balanced < frontier-reasoning`);
  `npm run models:select -- --lane L3 --risk secrets --role worker` resolves
  lane/risk/role floors to a tier + model + reasoning effort + the rule that decided
  it. Floors only *raise* the tier, never lower it.

---

## STEP E — The operating rules you must follow afterward

Once ADG is installed, you (and any agent in this repo) are bound by its contract.
Read `AGENTS.md` for the authoritative version; the essentials:

1. **Lane the work first — your call, recorded.** (v2.1) Judge the lane from the
   actual scope of the change and state it when you start;
   `npm run work:classify -- --intent "..." --file path` is a recorder / second
   opinion, not the decider — its keyword matcher is advisory, and a capable
   model's scope judgment wins on conflict. Proofline lanes: **L0 spike**
   (read-only exploration — no audit/gate), **L1 quick-fix** (docs/CSS/small bugs —
   nearest focused check), **L2 bounded slice** (normal feature work — context
   slice + targeted tests), **L3 sensitive** (auth, RBAC, schema, migrations,
   secrets, billing, production, guardrails, audit, governance tooling — policy
   gate + negative tests), **L4 release signoff** (full governance/traceability
   gate). If new evidence raises risk, upgrade the lane immediately; never
   silently downgrade on sensitive behavior, and record a reason if you disagree
   downward from the classifier's call.
2. **Guardrails are deny-by-default.** `read-only`/`generated-artifact`/`code-change`
   run freely; `migration`/`secrets`/`billing`/`production` need confirmation;
   `destructive` is denied unless explicitly requested. Resolve a sensitive action
   with `npm run guardrails:check -- --tool <name>` and supply its `requiredEvidence`.
3. **The audit log is append-only.** Record an event before finishing material work
   via `npm run audit:record -- --feature <ID> --type status --status <state>
   --summary "..."` — never via a shell redirect or editor (the hook blocks it),
   never with secrets in it. Validate the hash chain with `npm run audit:validate`.
4. **One backlog source of truth — pick the shape that fits the decomposer.** (v2.1)
   For fine-grained agent-driven decomposition (per-task tier/lane/deps/
   first-failing-test/files/evidence — the shape Fable-class models produce
   natively), the canonical backlog is **markdown epics + a deterministic parser
   manifest**, and the SQLite store is a ledger/mirror, not the driver. For
   coarser human-curated backlogs, `data/backlog.sqlite` rebuilt from a seed with
   event-derived state (`backlog:next → claim → start → complete → verify`)
   remains canonical. Either way: exactly one canonical source, state never
   hand-edited, and the other representation explicitly labelled a mirror. (Field
   evidence 2026-07-02: a 474-task model-decomposed backlog outgrew the SQLite
   schema within hours of real use; markdown + manifest is what shipped.)
5. **Context discipline.** A bounded packet (`npm run context:slice` /
   `context:feature`) is available when it helps and is no longer a required first
   step (v2.1); read what the task needs. Never bulk-load the generated mirrors —
   they are on the `forbiddenBulkFiles` denylist (read-only structured queries are
   fine; dumping raw contents is not).
6. **Evidence tiers + the release gate.** Every verify carries an ordered tier:
   `asserted < config < test < live`. An item under a `release-class:*` feature
   cannot reach `verified` on `asserted`/`config`/`test` alone — it needs a `live`
   event. `npm run backlog:validate` fails while the release gate is violated.
7. **Required gates** (run the relevant one, not the whole gate, for small work):
   `backlog:validate` after backlog changes · `audit:validate` after an audit append ·
   `guardrails:check` on policy changes · `agent:evals` on guardrail/eval/AI-security
   changes · `metrics:dora` on delivery-process changes · `ci:governance` at feature
   completion / before push / for L4 signoff · `adg:doctor` to catch drift.

---

## STEP F — Definition of done (your self-check before you report)

You are done only when **all** of these are true; report each explicitly:

- [ ] Prerequisites passed (Node ≥ 20, `sqlite3`, git).
- [ ] **Path A:** `npm run ci:governance` exited 0 **and** `npm run adg:doctor` is
      conformant. **Path B:** `npm run adg:doctor -- --target <repo>` is conformant
      and `adg:install:status` shows no drift.
- [ ] You named every check that could not run and why (e.g. Rust `asset:lint`
      helper not built → gate skips green; no `AGENTS.md` → `CLAUDE.md` not
      generated).
- [ ] You did not weaken any policy, hand-edit a generated mirror or the audit log,
      or commit secrets.
- [ ] If the work was material, you recorded an audit event and validated the chain.

### Hard rules for this setup task

- Do not invent commands, flags, or model IDs — every command here maps to a real
  `package.json` script; verify against `package.json` if unsure.
- Do not relax a control, downgrade a lane on sensitive work, or rewrite the audit
  log to make a gate pass. A waived gate requires an audit `decision` event with
  reason, risk, and rollback.
- Prefer predictable failure to unpredictable success: if a step fails, stop and
  report it with its output rather than working around it.
