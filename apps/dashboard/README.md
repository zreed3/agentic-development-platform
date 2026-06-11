# ADG Dashboard

A lightweight, read-only SvelteKit dashboard for Agentic Development Platform
governance visibility: backlog, append-only audit log, guardrail policy,
AI-security evals, and DORA-style delivery proxies. No login.

## How it reads data

The dashboard adds no data dependencies. Server load functions read the repo's
existing artifacts directly:

- `data/backlog.sqlite` via the `sqlite3` CLI (`-json -readonly`)
- `data/audit/audit-log.jsonl`
- `config/agentic/guardrails.json`
- `data/agent-evals.json`
- `data/delivery-metrics.json`

The repo root is resolved as `../..` from this directory; override with
`ADG_ROOT=/path/to/repo` when serving a built app from elsewhere.

## Run

```sh
# in the ADG repo itself
npm run dashboard:dev      # dev server (installs nothing at root)
npm run dashboard:build    # production build (adapter-node)

# in a host repo (installed via `adg:install --dashboard on` at apps/adg-dashboard)
npm run adg:dashboard      # installs the dashboard's own deps on first run, then serves

# or from this directory
npm install
npm run dev
```

## Docker

The image holds only the app; mount the governed repo read-only at `/repo`
(the data layer re-reads it on every request, so refreshes stay live):

```sh
# from the repo root (in a host repo, use apps/adg-dashboard)
docker build -t adg-dashboard apps/dashboard
docker run --rm -p 3000:3000 -v "$PWD:/repo:ro" adg-dashboard
# → http://localhost:3000
```

Refresh the underlying data with the root commands (`npm run setup:demo`,
`npm run agent:evals`, `npm run metrics:dora`) — the dashboard re-reads on
every request, so a browser refresh picks up changes.
