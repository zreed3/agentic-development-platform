---
description: Classify the work into a Proofline lane before spending tokens on context or gates.
argument-hint: [short intent describing the work]
---

Classify the work I am about to do into an ADG Proofline lane, then proceed within it.

Run the classifier:

`npm run work:classify -- --intent "$ARGUMENTS"`

Report back: the lane (L0 spike / L1 quick-fix / L2 bounded slice / L3 sensitive / L4 release-signoff), whether a full governance gate is required, the audit requirement, and the stop conditions.

Then work *within that lane*: do not run the full governance gate for L0/L1 work, and immediately upgrade the lane if new evidence raises risk (auth, schema, migrations, secrets, billing, production, or a signoff claim).
