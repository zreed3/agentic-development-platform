---
name: adg-risk-classifier
description: Use before implementation or review work to choose the cheapest safe Proofline lane and avoid unnecessary governance gates.
---

# ADG Risk Classifier

Use this before material work when the lane is not obvious.

## Workflow

1. Run:

   ```sh
   npm run work:classify -- --intent "<task summary>" --file <path>
   ```

2. Use the returned lane:
   - `L0 spike`: read-only exploration only.
   - `L1 quick-fix`: small UI, docs, copy, or low-risk bug fix.
   - `L2 bounded slice`: normal implementation.
   - `L3 sensitive`: auth, RBAC, data scope, schema, policy, audit, or production risk.
   - `L4 release signoff`: verified, release-ready, RC, GA, or signoff claim.

3. Upgrade immediately if sensitive scope appears.

## Output

Keep caveman output short:

```text
lane L1 quick-fix
files <paths>
checks <targeted checks>
full gate no
```

Never downgrade sensitive or signoff work without a recorded decision.
