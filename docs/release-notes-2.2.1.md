# ADG v2.2.1

This release publishes the ADG modernisation changes already merged into main
and updates the version and documentation. The release description and README
introduction have been rewritten in plain language, with completed changes
separated from planned work.

## Changes included

- New projects default to Git and Markdown setup. Managed governance is an
  explicit option; existing installations retain their configured controls.
- Claude instructions use a thin adapter to the shared AGENTS.md file. Unique
  project notes are preserved.
- Updates preserve host settings and report managed-file conflicts. Retirement
  preserves context and original records before removing managed integration.
- Context export produces Markdown with source references and preserved originals.
- Evaluation tools plan trials, validate run records, and report results. Actual
  Astra/Fable comparisons have not been run; empty results are reported as not run.
- Model selection guidance preserves explicit user choices and requires checking
  which model is available in the current runtime.

## Coordination beyond Git

Git records code changes and supports review and integration. ADG adds task
claims, scoped context, action controls, audit history, and release evidence.
This additional layer supports multi-agent coordination by giving agents explicit
work boundaries and a record of decisions and checks across sessions.

The current SQLite backlog is local. This release does not add shared task state
across machines, cross-account messaging, or automatic remote agent dispatch.

## Next minor version: v2.3.0

The next minor version is focused on improved multi-agent orchestration. Planned
work covers shared task ownership, structured handoffs across machines, and
independent review where agents share requirements but investigate from different
perspectives. See the [orchestration direction](multi-agent-orchestration.md).

## Validation

The full governance gate passed, including installer preservation, retirement,
context export, instruction adapters, MCP runtime, and evaluation tooling tests.
Image lint was skipped because the optional Rust binary was not built; this
release changes no images. Passing these checks does not establish a
model-performance advantage.
