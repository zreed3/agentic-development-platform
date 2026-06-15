# Write-scope enforcement (context-bound workers)

ADG can bind a worker sub-agent to a single backlog item's files, deterministically.
A soft instruction ("stay in your scope") is enough for a model that follows
instructions, but not for one that will find a way around a rule to get the job done.
So write-scope is enforced outside the model, at the deterministic PreToolUse hook, the
one control surface a prompt cannot talk around. Style rule: no em dashes.

## How it works

When an orchestrator spawns a worker, it sets `ADG_WRITE_SCOPE` in the worker's
environment to the item's write scope: a comma or newline separated list of path
prefixes or globs, relative to the repo root (for example
`scripts/asset-lint.mjs,tooling/adg-as-code/`). The shared hook
(`plugins/adg-governance/hooks/adg-guardrail-hook.mjs`) then enforces, for every tool
call in that worker's process:

- Edit / Write / MultiEdit / NotebookEdit: the `file_path` must be inside the scope,
  after collapsing `.` and `..` so traversal cannot escape. This surface is airtight.
- Bash: every literal write target is extracted (redirects in all forms including `>|`,
  `>&`, `&>`, no-space and quoted; `tee`, `sed -i`, `dd of=`, `truncate`, `mktemp`,
  `patch -o`, and `cp`/`mv`/`install`/`ln`/`rsync` destinations including `-t` and a
  symlink's points-at target) and checked against the scope.
- Under an active scope, commands whose write target cannot be bounded statically are
  blocked outright (fail closed): inline interpreter programs (`python -c`, `node -e`,
  `perl -e`, and the like), `git apply`/`am`/`restore`/`checkout`/`stash`, `patch`,
  sourcing a script (`.`/`source`), `eval`, the line editors `ed`/`ex`, and `xargs`
  piped into a write command. A context-bound worker edits with the Edit/Write tools, so
  blocking these is not a real loss.
- Any attempt to unset or override `ADG_WRITE_SCOPE` from inside the run is blocked.

Activation is env-driven and unconditional: it is not a toggleable control, so a worker
cannot relax it from inside its own run. The Codex adapter
(`.codex-plugin/hooks/adg-codex-pretool.mjs`) spawns the same shared hook and inherits
the env, so the same scope is enforced under both harnesses from one policy.

Reads are never restricted. With `ADG_WRITE_SCOPE` unset (the parent, or any normal
session), there is no scope restriction and behaviour is unchanged; the always-on
destructive, audit-append-only, and forbidden-bulk controls still apply in all cases.

## Verification

A red-team of Claude-model agents tried to escape the scope by every means (redirect
tricks, traversal, file-mutation commands, interpreters, patch, git tree
materialisation, symlinks, line editors, xargs). `npm run test:adg-write-scope` (wired
into `ci:governance`) pins the closed escapes plus the in-scope-allowed and
no-scope-unrestricted cases, for both the Claude hook and the Codex adapter.

## Trust boundary (stated honestly)

The Edit/Write surface is airtight. On the Bash surface, the literal-path writes are
scope-checked and the unbounded-write command families are blocked, so the ordinary ways
to write a file are all covered. The residual boundary is arbitrary code obfuscated to
reconstruct a write primitive at run time (for example a string-built `writeFileSync`
inside an interpreter that itself is constructed to dodge the interpreter pattern). A
regex hook cannot parse that, by nature. The mitigations are that a context-bound worker
has no legitimate need to run such a command, the obvious interpreter and indirection
families are already blocked under scope, and the worker's standard edit path
(Edit/Write) is fully governed. As with the audit chain, prevention is layered: the hook
plus the worker's own narrow tool use, with the orchestrator integrating in the parent.
