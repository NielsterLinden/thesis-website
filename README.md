# Thesis Companion

A password-gated companion site that lets supervisors and examiners interrogate a
master's thesis, its codebase, and a frozen Weights & Biases experiment export
through a single LLM agent. The agent has several tool surfaces — thesis-in-context,
agentic code grep/read, frozen-CSV W&B queries, and V2 axis lookup — and cites a
verifiable source for every factual claim.

> **One LLM agent with several tool surfaces, not three separate systems.**
> Anthropic is called as a hosted endpoint; this repo is only a thin orchestrator.
> No model hosting, no GPU, no database.

The full architecture, build order, and deployment steps live in
[`Initial_plan.md`](./Initial_plan.md) — the founding runbook. Read it before any
structural change. Guidance for AI coding agents is in [`CLAUDE.md`](./CLAUDE.md).

## Status

MVP built end to end: backend, frontend, and Docker image are on `main`, and all
seven §9 acceptance checks pass locally under `docker compose` (citations,
refusal behavior, gate, PDF). Phase 2 (W&B report authoring) is built — the
`author_report` tool, the two-call confirm gate, and the Python sidecar — and
stays dormant until the `WANDB_*` env vars hold real values. Next: create the
Render Blueprint instance, and run `python sidecar/smoke_test.py --save` (the
§10 verification) once before enabling report authoring in production.

## Layout

| Path | What |
|------|------|
| `thesis-src/` | Pinned git submodule: the thesis repo (transformer-workbench code + TeX + `docs/AXES_REFERENCE_V2.md`). |
| `data/04_thesis_final.csv` | Frozen W&B export — the in-process query database. No live W&B read path. |
| `web/thesis.pdf` | Compiled thesis, served static. |
| `backend/` | NestJS orchestrator: agent loop with prompt caching, password gate, the four MVP tools (`repo_grep`, `repo_read`, `wandb_query`, `axes_lookup`). |
| `web/` | React (Vite) frontend: chat with citation chips, password gate, PDF viewer. Built to `web/dist`, served by Nest. |
| `render.yaml` | Render Blueprint for the free-tier deploy. |
| `sidecar/` | Python W&B report renderer (Phase 2): `render_report.py` (validated spec → draft report) and `smoke_test.py` (the §10 pre-deploy verification). |

## The thesis submodule

`thesis-src` is pinned to a specific commit so the site reflects an exact snapshot
of code + TeX, not a moving branch — this is an examiner-facing artifact. Currently
pinned to [`NielsterLinden/Thesis`](https://github.com/NielsterLinden/Thesis) @
`9f0c964`. After cloning this repo:

```bash
git submodule update --init --recursive
```

To bump the snapshot, follow the thesis-refresh workflow in `Initial_plan.md` §3.1
(check out the new commit; refresh `data/04_thesis_final.csv` if the run set
changed; re-run the §9 acceptance checks; commit the bumped pointer as one
`Refresh thesis snapshot to <short-sha>` commit).

## Local development

```bash
docker compose build && docker compose up   # -> http://localhost:8080
```

For faster iteration outside Docker: `npm run start:dev` in `backend/` (serves
the API and `web/dist` on :8080) and `npm run dev` in `web/` (Vite dev server,
proxies API routes to :8080).

Secrets live in `.env` (git-ignored); `.env.example` is the committed contract.
Use a **dedicated, spend-capped** Anthropic key — never a personal key.

## Deployment

Render free tier, defined in [`render.yaml`](./render.yaml): dashboard → New →
Blueprint → this repo. Render prompts for the secrets (`ANTHROPIC_API_KEY`,
`SITE_PASSWORD`, and the optional `WANDB_*` trio — leave those blank to ship
with report authoring disabled). The `thesis-src` submodule is public, so
Render clones it without extra auth. After the first deploy, re-run the §9
acceptance checks against the live URL.

The Blueprint pins `claude-haiku-4-5` with `ANTHROPIC_EFFORT=none` and tight
per-question caps: one question is bounded at ~$0.50 even in the adversarial
worst case (~$0.03–0.15 typical with a warm prompt cache).

## Report authoring (Phase 2)

Visitors can ask the agent to draft a W&B report ("save AUROC by B1 as a
report"). The agent's `author_report` tool only **validates** a structured
spec and computes the matching run counts from the frozen CSV; the browser
then shows a confirm card, and only a human click POSTs the spec to
`/reports/save`, which re-validates and runs `sidecar/render_report.py`
(`wandb-workspaces`). Reports are always saved as **drafts**, only ever into
`WANDB_TARGET_PROJECT` (`thesis-visitor-reports`) — the model never authors
the save, and report creation itself costs zero model tokens. Before first
production use, run the §10 verification once:

```bash
pip install -r sidecar/requirements.txt
python sidecar/smoke_test.py          # read-only: confirm live config-key form
python sidecar/smoke_test.py --save   # creates one trivial draft report; verify, then delete it
```
