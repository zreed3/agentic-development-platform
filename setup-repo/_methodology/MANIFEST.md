# bord.room V4.1 Methodology Bundle

This folder is a portable copy of the agentic development methodology assets.
Use it when setting up or reviewing a repo that should follow the same
token-sliced, evidence-backed delivery workflow.

## Contents

- `dev-system/` - copied from `development/_system`; includes the single-page
  methodology wiki, `system.json`, validator, and the 14 `dev-*` skills.
- `repo-lite-skills/` - copied from `skills/`; includes the existing Lite build
  runner and Lite traceability skills.
- `docs/agentic-application-development-pipeline.md` - active process overview.
- `documents-for-review/v4-1-agentic-development-strategy-lite.md` - Zach-facing
  Lite methodology review note.
- `config/agentic/context-profiles.yaml` - token-bounded context profiles.
- `config/agentic/guardrails.json` - local agent action/risk policy.
- `root/AGENTS.md` - repo-level agent behavior and V4.1 delivery instructions.

## Validate

```sh
node development/setup-repo/_methodology/validate-methodology.mjs
```

This checks the copied `dev-system` plus the expected methodology files.

## Source Policy

This is a setup bundle, not the canonical execution source. In the active
bord.room repo, the canonical sources remain:

- `development/_system`
- `skills/`
- `AGENTS.md`
- `config/agentic/`
- `docs/traceability/v4-1-backlog.sqlite`
- `docs/traceability/v4-1-development-tracker.sqlite`
- `docs/traceability/v4-1-development-audit.jsonl`

