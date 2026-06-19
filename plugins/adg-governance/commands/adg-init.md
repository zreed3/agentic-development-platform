---
description: Install ADG governance into this repo with a zero-onboarding flow + a value proof.
argument-hint: [optional: --target DIR --client claude|codex|both]
---

Install the deterministic ADG guard into the repo, then prove value immediately by classifying
the current pending changes.

Run init:

`npm run adg:init -- $ARGUMENTS`

It detects the host (`.claude`/`CLAUDE.md` → claude, `AGENTS.md`/`.codex` → codex), installs the
deterministic enforcement layer via the tested installer, and classifies the working-tree
changes into a Proofline lane so the first thing shown is a real decision, not configuration.

Report back: the detected client, what was installed, and the lane classification of the current
changes. Then point to next steps — `adg classify` to pick a lane for new work, and
`adg doctor` to verify the install has not drifted.
