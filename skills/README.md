# Codex Skills

Two portable skills encode the platform's disciplines so they survive across
repos and across agents:

- **`agentic-traceability`** — keep the append-only audit log and SQL backlog
  current while building.
- **`agentic-build-runner`** — execute backlog items end to end (select → claim →
  implement → test → record evidence → commit-ready). Loads `agentic-traceability`
  as a companion.

These are generalized from the original `bordroom-traceability` and
`bordroom-build-runner` skills (see [`../docs/reference/extraction-notes.md`](../docs/reference/extraction-notes.md)).
They reference only the platform's generic `npm run ...` commands, so they work in
any repo that adopts this layer.

## Install (Codex / OpenAI agents)

Codex discovers skills under `~/.codex/skills`. Symlink them so edits here stay live:

```sh
ln -s "$(pwd)/skills/agentic-traceability" ~/.codex/skills/agentic-traceability
ln -s "$(pwd)/skills/agentic-build-runner"  ~/.codex/skills/agentic-build-runner
```

Or copy them if you prefer a frozen snapshot:

```sh
cp -R skills/agentic-traceability ~/.codex/skills/
cp -R skills/agentic-build-runner  ~/.codex/skills/
```

Invoke with `$agentic-traceability` / `$agentic-build-runner` in an agent session.

For the static ADG setup guide, see [`../docs/setup.html`](../docs/setup.html).
It includes the manual install path, skill installation options, adoption steps,
and Otterblock contact details.

## Use with other agent runtimes

The skills are plain Markdown with YAML frontmatter (`name`, `description`) and an
optional `agents/openai.yaml` interface hint. Any runtime that loads Markdown
instructions can use them — point your runtime's skill/instruction loader at this
directory, or paste the relevant `SKILL.md` into the system prompt. The content is
runtime-agnostic; only the discovery path differs.
