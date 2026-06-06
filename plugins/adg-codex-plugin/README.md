# ADG Codex Plugin

ADG Codex Plugin packages Agentic Development Governance workflows for Codex as
a standalone, installable plugin. It helps agents start from bounded feature
slices, validate requirements-to-UX lineage, map local controls to standards,
and audit deliverables without implementing an autonomous runtime.

This plugin is a control-plane bundle. It guides and constrains the agent that
invokes it; it does not replace Codex or run work on its own.

## License

This package is public source-available software from Otterblock Pty Ltd under
the PolyForm Noncommercial License 1.0.0. Noncommercial use is permitted.
Commercial rights are reserved by Otterblock Pty Ltd.

## Install Through Codex Marketplace

The dedicated marketplace source is:

```sh
codex plugin marketplace add zreed3/adg-codex-plugin
```

After adding or upgrading the marketplace, restart Codex and install
`adg-codex-plugin` from the marketplace.

## What It Bundles

- `skills/` reusable Codex workflows for bounded delivery, requirements-to-UX,
  and standards evidence.
- `scripts/` vendored ADG command snapshots that operate on the host repo as
  the working directory.
- `config/templates/agentic/` starter config files for host repo adoption.
- `.agents/plugins/marketplace.json` Git-backed marketplace metadata.

## Host Repo Expectations

Run plugin commands from the governed host repo as the working directory. The
host repo should provide ADG-compatible `config/`, `data/`, and `tooling/`
files. Use the templates in `config/templates/agentic/` when adopting ADG into
a new repo.

Example:

```sh
node /path/to/adg-codex-plugin/scripts/adg-context.mjs slice --feature S07 --workflow agentic-tooling
```

## ChatGPT Apps MCP Status

This release is a Codex plugin and marketplace package, not a ChatGPT Apps MCP
server. A later MCP adapter should expose read-only tools with explicit
`readOnlyHint`, `openWorldHint`, `destructiveHint`, and `outputSchema` metadata
before generating a ChatGPT app submission package.
