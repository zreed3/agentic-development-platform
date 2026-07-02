---
description: Record the Proofline lane for the work — you make the lane call; the classifier is a recorded second opinion.
argument-hint: [short intent describing the work]
---

Lane the work I am about to do into an ADG Proofline lane (L0 spike / L1 quick-fix / L2 bounded slice / L3 sensitive / L4 release-signoff) **from your own read of the actual scope of the change**, then record it.

Run the classifier as a recorder / second opinion:

`npm run work:classify -- --intent "$ARGUMENTS"`

Its keyword matcher is advisory (v2.1): your scope judgment wins on conflict. If it lanes higher than you did, take that as a prompt to re-check — and if you still disagree downward, record why. Never silently downgrade sensitive work.

Report back: your lane call, the classifier's call if it differed, whether a full governance gate is required, the audit requirement, and the stop conditions.

Then work *within that lane*: do not run the full governance gate for L0/L1 work, and immediately upgrade the lane if new evidence raises risk (auth, schema, migrations, secrets, billing, production, or a signoff claim).
