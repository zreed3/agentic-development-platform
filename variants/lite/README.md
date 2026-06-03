# Agentic Development Governance Lite

ADG Lite is the low-token operating variant for complete-dev work. It keeps the
parts that make code safer: bounded context, explicit plan/design/build/test,
targeted checks, failed-result logging, and checkpoint gates. It removes the parts
that inflate token spend: broad discovery, generated mirror reads, per-micro-item
ceremony, and full gates after every small change.

This tree is intentionally separate from the root ADG implementation. It can be
copied into a host repo as a lightweight profile or used as a reference for a
future packaged variant.

## ASCII Architecture

```text
                              USER REQUEST
                                   |
                                   v
                         +-------------------+
                         | classify the work |
                         | feature / risk /  |
                         | workflow profile  |
                         +---------+---------+
                                   |
                                   v
      +--------------------+  SQL query only   +----------------------+
      | forbidden context  |<------------------| local SQLite backlog |
      | generated JSON/SQL |                   | current status views |
      | audit log / HTML   |------------------>| bounded packet rows  |
      +--------------------+   never bulk read +----------+-----------+
                                                            |
                                                            v
                                                   +------------------+
                                                   | delivery-slice   |
                                                   | context packet   |
                                                   | 3-6 files max    |
                                                   +--------+---------+
                                                            |
               +--------------------------------------------+--------------------------------------------+
               |                                            |                                            |
               v                                            v                                            v
       +---------------+                            +---------------+                            +---------------+
       | PLAN          |                            | DESIGN        |                            | BUILD         |
       | exact slice   |                            | RBAC/scope    |                            | scoped code   |
       | exact files   |                            | state contract|                            | related tests |
       +-------+-------+                            +-------+-------+                            +-------+-------+
               |                                            |                                            |
               +--------------------------------------------+--------------------------------------------+
                                                            |
                                                            v
                                                  +-------------------+
                                                  | TEST              |
                                                  | targeted commands |
                                                  | package checks    |
                                                  +---------+---------+
                                                            |
                            +-------------------------------+-------------------------------+
                            |                                                               |
                            v                                                               v
                 +---------------------+                                      +----------------------+
                 | failure path        |                                      | success path         |
                 | backlog:fail once   |                                      | one verify event     |
                 | fix same slice      |                                      | consolidated evidence|
                 +----------+----------+                                      +----------+-----------+
                            |                                                                |
                            +-------------------------------+--------------------------------+
                                                            |
                                                            v
                                                   +------------------+
                                                   | CHECKPOINT GATES |
                                                   | full governance  |
                                                   | release/pre-push |
                                                   +------------------+
```

## Operating Rules

- Use `delivery-slice` as the default workflow.
- Read the context packet first; read only named files unless local evidence points
  elsewhere.
- Never bulk-load generated tracker JSON, SQL dumps, audit logs, or generated HTML.
- Run targeted tests while building; run full gates only at feature completion,
  release checkpoints, process/tooling changes, or before push.
- Record failed test commands with `backlog:fail`.
- Record one consolidated verification event when the same evidence covers several
  tasks, tests, use cases, or criteria.

## Code Per Token Target

ADG Lite optimizes for safe code per token:

```text
good spend: bounded packet + relevant source files + targeted test output
bad spend: generated mirrors + broad summaries + repeated process narration
```

The expected packet size is a few KB. Any workflow that needs hundreds of KB of
generated context is not running in Lite mode.

## Tree Contents

```text
variants/lite/
├── README.md
├── AGENTS.md
└── config/agentic/context-profiles.yaml
```

## Adoption

Copy this tree into a host repo when the team wants the low-token policy without
the full ADG process surface. Keep the host repo's existing source tree intact.

Recommended host commands:

```sh
context:feature -- --feature <id> --workflow delivery-slice
backlog:fail -- --item <id> --summary "Targeted check failed" --evidence "<command>"
backlog:verify -- --item <id> --summary "Verified slice" --evidence "<command>"
```

