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

Bootstrapping the MVP. **Step 1** (repo init + pinned thesis submodule + frozen
data) is in place; the NestJS backend, React frontend, and Docker image come next.

## Layout

| Path | What |
|------|------|
| `thesis-src/` | Pinned git submodule: the thesis repo (transformer-workbench code + TeX + `docs/AXES_REFERENCE_V2.md`). |
| `data/04_thesis_final.csv` | Frozen W&B export — the in-process query database. No live W&B read path. |
| `web/thesis.pdf` | Compiled thesis, served static. |
| `backend/` | NestJS orchestrator (agent loop, auth guard, MVP tools). *Scaffolded in Step 3.* |
| `web/` | React (Vite) frontend. *Scaffolded in Step 5.* |
| `sidecar/` | Python W&B report renderer. *Phase 2 only.* |

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
# once the backend / web / Dockerfile exist (Steps 3–6):
docker compose build && docker compose up   # -> http://localhost:8080
```

Secrets live in `.env` (git-ignored); `.env.example` is the committed contract.
Use a **dedicated, spend-capped** Anthropic key — never a personal key.
