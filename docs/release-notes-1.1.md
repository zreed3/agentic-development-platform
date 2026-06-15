# ADG 1.1 release notes

Deliverable-quality controls. ADG 1.0 had strong security controls but no artifact-quality
control, so a defect that is encodable but off the security checklist could still ship. The
motivating case: a web image asset (lender logos) passed proxy metrics but shipped a logo
clipped at the canvas edge, violating the "recognisable logo" intent. 1.1 closes that class
and the general "off-checklist" class around it.

Style rule: no em dashes. Date: 2026-06-15.

## What is new in 1.1

### Deterministic asset-lint gate (the exact-defect fix)

A new toggleable `assetLint` control runs a deterministic quality gate over committed image
assets (`npm run asset:lint`). It rejects an edge-clipped export (every canvas-edge strip
must match the background, so content cannot touch an edge), a blank export (mean luminance
must sit inside a band), and a wrong format. Pixel reading is done by a small Rust helper
(`tools/adg-asset-lint`, built with `npm run asset:lint:build`); all policy and thresholds
stay in the Node orchestrator, which loads the control from the single policy source. This
is ADG's first non-Node component. When the Rust helper is not built, the gate skips green
by default (`config.onToolMissing: "skip"`), so ADG still runs on a host without the Rust
toolchain; set `onToolMissing` to `block` for hard enforcement. `assetLint` is toggleable,
not always-on, and toggling it stays a governed, audited action; `adg:doctor` flags a
hand-disabled control without a matching decision.

### Artifact-typed control packs (the general-class fix)

`config/agentic/artifact-types.json` maps a deliverable type to a versioned check set. A
deliverable that declares `type: web-image-asset` inherits the pack (dimensions, format,
blank guard, edge-clip, contrast, positive-on-light) and cannot pass `deliverable:audit`
without carrying its type's enforcing evidence (`npm run asset:lint`). Completeness becomes
a property of the control library, not the authoring agent's memory: every defect found once
becomes a new line in the pack. The standards map gains `ADG-CTRL-008`
(deliverable_artifact_quality).

### Visual-evidence release gate

A new `release-class:visual` class reuses the proven release gate: a feature with a UI or
visual surface cannot reach `verified` until a `live` event records a rendered-artifact
observation. A green that is metric-only on a visual deliverable is, by definition, a lower
tier. No change to the evidence-tier lattice.

### Completeness critic and signoff detection

The lane classifier's signoff detector gains terms (`approved`, `lgtm`, `ship it`,
`good to go`) so signoff-shaped language routes to L4. A new `/adg-completeness-critic`
command runs a stronger-tier "what is this checklist missing" pass over a UI or asset
deliverable, records a completeness pass, and ratchets any new encodable failure mode into
the artifact-type pack.

### Uncovered-intent lineage flag

The requirements-to-UX lineage now flags the reverse direction: a requirement covered by no
acceptance criterion is reported by `npm run elicitation:validate` as an advisory gap
("uncovered intent"), so a stated intent cannot pass only on proxy metrics.

## The ratchet

1 and 2 would have caught the original defect deterministically; 3 to 5 raise the floor for
the broader off-checklist class. The pattern is a ratchet: a strong-model completeness pass
discovers a novel failure once, and the asset-lint helper plus the artifact-type pack make
sure it is never missed again.

## Known limitations and post-1.1

- The asset-lint pixel checks cover raster formats the Rust helper decodes (PNG, WEBP, JPEG);
  SVG is checked for format and non-emptiness only, not rasterised.
- Contrast and positive-on-light are listed in the web-image-asset pack but the deterministic
  enforcement today is edge-clip, blank, and format; the remaining checks are advisory until
  encoded. New encodable checks are added through the ratchet.
- The Rust helper is built on demand, not shipped as a prebuilt binary; a host that wants hard
  enforcement installs Rust and runs `npm run asset:lint:build`.

## Upgrade notes

- Build the helper once with `npm run asset:lint:build` to activate enforcement locally;
  without it the gate skips green.
- Label features with a visual surface `release-class:visual` so the release gate requires a
  live rendered-artifact observation before sign-off.
- The compiled binary under `tools/adg-asset-lint/target/` is generated and gitignored; the
  Rust source and `Cargo.lock` are tracked and shipped by the installer.

## Sources

Grounded in `docs/agent-guides/adg-1.0-research-brief.md` and the friend-agent field report
that surfaced the clipped-logo defect. The visual release gate reuses the release-class
mechanism documented in `docs/release-notes-1.0.md`; the alignment mapping is in
`docs/governance-alignment.md`.
