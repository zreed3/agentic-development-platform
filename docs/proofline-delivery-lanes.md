# Proofline Delivery Lanes

Proofline is the lightweight name for the ADG delivery discipline: cheap work
stays cheap, but every serious claim has a proof line.

Proofline process version: `0.9.0` (`v0.9`).

The goal is not to run full governance on every small change. The goal is to
separate exploration from claims:

```text
classify -> choose lane -> gather bounded context -> run lane-sized checks -> upgrade if risk appears
```

## Lanes

| Lane | Use for | Evidence |
|---|---|---|
| `L0 spike` | Read-only exploration, options, triage, debugging | Notes only; no implementation or signoff claim |
| `L1 quick-fix` | Copy, CSS, small UI state, docs, obvious low-risk bugs | Nearest check, screenshot, or smoke proof |
| `L2 bounded slice` | Normal scoped implementation | ADG context slice plus targeted tests |
| `L3 sensitive` | Auth, RBAC, tenant/business scope, schema, migrations, secrets, billing, production, guardrails, audit, governance tooling, CI policy | Policy-specific gate, negative tests where applicable, and ADG validation |
| `L4 release signoff` | GitHub push/PR, pre-push, RC, GA, release, verified, release-ready, or signed-off claims | Full governance / traceability gate |

## Classify First

```sh
npm run work:classify -- --intent "quick css spacing fix" --file docs/setup.html
npm run work:classify -- --intent "change tenant permission checks" --file src/auth.ts --format json
npm run adg:guard -- --event github-push --intent "GitHub update pre-push"
```

The classifier is deterministic and conservative. The guard command classifies
the current changed files plus event intent, so raw Codex, Claude Code, Cursor,
and shell harnesses can call it before GitHub-bound updates. If local evidence
raises risk, upgrade the lane immediately.

## Ultra Caveman Mode

For L0/L1, keep agent output short:

```text
lane L1 quick-fix
files docs/setup.html
checks screenshot
full gate no
next done
```

Do not paste large context packets, generated mirrors, or full test logs unless
the failure needs them.

## Signoff Boundary

The signoff pipeline is still the final goal. Use it when the work needs a
release, RC, GA, verified, or signed-off claim. Do not use it as the cost of
every spike or small UI fix.

`L0` and `L1` can say "observed", "changed", or "checked". They cannot say
"verified", "release-ready", or "signed-off". Those words require `L4`.

## GitHub Boundary

GitHub-bound changes must go through:

```sh
npm run adg:guard -- --event github-push --intent "GitHub update pre-push"
npm run ci:governance
```

`npm run prepush` runs both. Host repos can map this same boundary to their own
full-gate command while preserving the lane semantics.

## Install Or Update In A Host Repo

From this source repo:

```sh
npm run adg:install -- --target /path/to/host-repo
npm run adg:update -- --target /path/to/host-repo
npm run adg:install:status -- --target /path/to/host-repo --format json
```

The installer copies the portable lane policy, classifier/guard, and docs into
the host repo, adds `adg:classify`, `adg:guard`, and `adg:prepush` package
scripts when `package.json` exists, and records
`config/agentic/adg-install-state.json` so updates can detect the installed
version and managed files.

Existing unmanaged files are not overwritten by `install` unless `--force` is
used. `update` refreshes managed files and writes `.adg-backup-*` copies when it
replaces an existing file.

## ADG Command Aliases

These aliases keep host docs and signoff artifacts aligned with this repo:

```sh
npm run adg:sync
npm run adg:context -- --feature S07 --workflow delivery-slice
npm run adg:validate
npm run adg:guard -- --event github-push --intent "GitHub update pre-push"
npm run ci:traceability
```

`adg:sync` rebuilds the local SQLite database from the configured seed. Host repos
can replace that script with a source-specific sync without changing the runbook.
