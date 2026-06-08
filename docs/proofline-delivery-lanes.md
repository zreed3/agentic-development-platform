# Proofline Delivery Lanes

Proofline is the lightweight name for the ADG delivery discipline: cheap work
stays cheap, but every serious claim has a proof line.

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
| `L3 sensitive` | Auth, RBAC, tenant/business scope, schema, migrations, secrets, billing, production, guardrails, audit, governance tooling | Policy-specific gate and negative tests where applicable |
| `L4 release signoff` | Pre-push, RC, GA, release, verified, or signed-off claims | Full governance / traceability gate |

## Classify First

```sh
npm run work:classify -- --intent "quick css spacing fix" --file docs/setup.html
npm run work:classify -- --intent "change tenant permission checks" --file src/auth.ts --format json
```

The classifier is deterministic and conservative. It can be wrong in the safe
direction. If local evidence raises risk, upgrade the lane immediately.

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

## ADG Command Aliases

These aliases keep host docs and signoff artifacts aligned with this repo:

```sh
npm run adg:sync
npm run adg:context -- --feature S07 --workflow delivery-slice
npm run adg:validate
npm run ci:traceability
```

`adg:sync` rebuilds the local SQLite database from the configured seed. Host repos
can replace that script with a source-specific sync without changing the runbook.
