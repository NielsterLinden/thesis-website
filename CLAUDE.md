# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: greenfield

The repository currently contains only `Initial_plan.md` — the founding runbook for the whole site. There is no code, no submodule, no Dockerfile yet. Read `Initial_plan.md` before doing structural work; it is the source of truth for the architecture, file layout, build order, and deployment steps.

## What we are building

A password-gated companion site for a thesis (TeX + compiled PDF), its codebase, and a frozen Weights & Biases experiment export. **One LLM agent with several tool surfaces, not three separate systems.** Anthropic is called as a hosted endpoint; we host only a thin orchestrator.

```
React (static) -> NestJS backend -> Anthropic API
                       |
                       +-- tools: thesis_context, repo_grep/read,
                       |          wandb_query (frozen CSV), axes_lookup,
                       |          author_report (Phase 2)
                       |
                       +-- Python sidecar (Phase 2 only): JSON spec ->
                                wandb-workspaces -> draft report
```

All of this ships as **one Docker image** (Node + Python) deployed to **Render** (free web-service tier). No database.

## Architectural invariants — do not relitigate

These are decisions from `Initial_plan.md` §0. Treat them as constraints unless the user explicitly reopens them:

- **No model hosting, no GPU, no Azure Foundry.** A direct Anthropic key with a monthly spend cap is the entire inference infrastructure.
- **The frozen CSV (`data/04_thesis_final.csv`) is the database.** `wandb_query` reads it in-process. There is no live W&B read path and no MCP subprocess for queries.
- **Thesis (~50 pages, ~30–40k tokens) is loaded whole into context — not RAG.** Same for the codebase: access is agentic grep/read over the `thesis-src` submodule, not embeddings. The questions here are explanatory ("how and why was X done") — the regime where reading real code beats retrieving snippets.
- **Prompt caching on the static prefix is mandatory.** System prompt + thesis TeX + axes reference are marked with `cache_control` on every `/chat` call. Default model is Opus 4.7 (`claude-opus-4-7`); without caching the cost is ~10x higher per turn and the spend cap stops being a comfortable ceiling.
- **Every answer cites its sources.** Tool returns carry anchors; the system prompt requires the model to emit citation tokens (`[thesis: §4.2, Eq. (4.7)]`, `[code: path:lines]`, `[wandb: filters, N=N, median]`) and to refuse rather than fabricate when no tool-grounded evidence exists. The frontend renders these as verifiable references. This is the load-bearing trust property for an examiner-facing tool.
- **The report spec is library-agnostic JSON.** Claude emits intent; only `sidecar/render_report.py` knows that `wandb-workspaces` exists. When the Public Preview API shifts, patch one Python file, not the model prompt.
- **Report authoring is the only Python**, and it only runs in Phase 2. The MVP image can omit the Python install.
- **Stateless backend.** No sessions, no users table. The browser holds chat history; the server validates a shared-password header on every `/chat`.
- **`thesis-src` is a pinned git submodule.** The site reflects a specific snapshot of code+TeX, not a moving branch — this is an examiner-facing artifact.

## Phasing

- **MVP**: thesis-in-context, repo grep/read, frozen-CSV W&B queries, axes lookup, shared-password auth, static PDF.
- **Phase 2 (additive)**: `author_report` tool + Python sidecar + confirm-gate UI for drafting W&B reports.

Build the MVP end to end and deploy it before touching Phase 2. The Dockerfile and repo layout are designed so Phase 2 is additive, not a rewrite.

## Hard rules for report authoring (Phase 2)

Bake these into every code path that touches W&B writes:

- W&B reports are always created as **drafts**, never auto-published.
- Confirm-before-save is a **two-call protocol**, not a next-user-turn "yes": `author_report` returns the validated spec + plain-language summary (panel kind, metric, filters, group counts, target project); the frontend renders a confirm button; click POSTs to a separate `/reports/save` endpoint that re-validates and invokes the sidecar. The model never authors the save. This is a security boundary, not a UX detail.
- The W&B key is scoped to **write only to `thesis-visitor-reports`**. It must never be able to mutate the canonical project that holds the thesis-of-record runs.
- Filters in the report spec are **structured triples** (`field`, `op`, `value`) with `op` from a closed set (`==`, `!=`, `in`, `>`, `<`, `>=`, `<=`). Never accept raw filter-expression strings — that would let arbitrary code be smuggled through a filter.
- Two namespaces in the spec: summary metrics (y-values, e.g. `eval_v2/test_auroc`) and config axes (filter/groupby fields, addressed as `config:<path>.value`). `axes_lookup` resolves V2 aliases to formal config keys before the spec is built, so the stored spec is unambiguous.
- ROC curves are array-valued and live in per-run tables, not scalar summaries — they are **not** a `line` panel and need a custom-chart path deferred to a later Phase 2 increment.

Before writing the renderer, run the §10 smoke test against one real run to confirm the literal config-key syntax and the v2 filter-expression form — `wandb-workspaces` is Public Preview and those two strings are the most likely failure mode.

## Conventions carried from the thesis

The agent's system prompt and any tool that formats results must reflect these. They are the thesis's vocabulary, not stylistic preferences:

- **Reason in V2 axis IDs** (`B1`, `T1`, `A3`, `D2`, …). Keep physics-motivated and ML-motivated reasoning explicitly distinct.
- **Median, not mean, across seeds** — there are structural outliers.
- **`<not_applicable>`** is the literal string sentinel for conditional axes, not NaN/null.
- **Continuous feature index**: `[0,1,2,3] = [E, Pt, eta, phi]`. Energy is index 0, Pt is index 1. This is not four-momentum.
- V2 aliases are a thesis-facing presentation layer; the frozen canonical W&B IDs are not renamed. `axes_lookup` reads `AXES_REFERENCE_V2.md` directly from the `thesis-src` submodule (not a copy in `backend/reference/`) — the thesis iterates, and a duplicated reference would drift silently against the next snapshot. The submodule pin is what locks the agent's axis ground-truth to a known commit.

## Secrets and safety

- `.env` is git-ignored; `.env.example` is the committed contract. Real secrets live only in `.env` locally and in the deployment platform's secret store.
- Use a **dedicated, spend-capped Anthropic key** for this site, not a personal key. Starting cap: $50/month — Opus 4.7 with prompt caching across ~3 examiners visiting a handful of times keeps actual spend well below this; a leaked password hits the ceiling quickly.
- `ANTHROPIC_MODEL` defaults to `claude-opus-4-7`. It's read from env so swapping is a config change, not a code change — verify the current string in the Anthropic docs at deployment time rather than hardcoding from memory.
- **Single instance** (`max_instances = 1`). The in-memory rate limit and per-conversation caps do not survive a second replica; horizontal scaling is not on the roadmap (3 examiners, single-digit concurrency).
- **Per-conversation caps** (`MAX_CONVERSATION_INPUT_TOKENS`, `MAX_TOOL_CALLS_PER_TURN`) enforced in the agent loop. With no transcripts persisted, these are the only per-request backstop against a runaway loop.
- **No conversation inputs/outputs in logs.** Telemetry is metadata only: request id, timestamp, tool call names, token counts, status. Stdout is the only sink.
- `repo_grep` / `repo_read` constrained to the `./thesis-src` directory (resolve absolute paths, reject symlink escapes). `repo_grep` results capped on match count and bytes.
- `wandb_query` accepts **structured filter triples only** — never raw expression strings that would be `eval`'d.

## Commands

The repo is greenfield; the commands below come from `Initial_plan.md` and will exist once the relevant step is built. Run from the repo root unless noted.

- Submodule bootstrap (after `thesis-src` is added): `git submodule update --init --recursive`
- Local Docker run: `docker compose build && docker compose up` → http://localhost:8080
- Backend (non-Docker iteration, from `backend/`): standard NestJS — `npm run start:dev`, `npm run build`, `npm test`. Scaffold with `npx @nestjs/cli new . --package-manager npm`.
- Frontend (from `web/`): standard Vite (`npm create vite@latest . -- --template react-ts`) — `npm run dev`, `npm run build` (outputs `web/dist/`, which Nest serves).
- Python sidecar deps (Phase 2 only): `pip install -r sidecar/requirements.txt`.
- **Thesis-refresh workflow** (when the submodule snapshot bumps): in `thesis-src/` check out the new commit, drop in a refreshed `data/04_thesis_final.csv` if the run set changed, re-run the §9 acceptance checks under `docker compose up`, then commit the bumped submodule pointer (+ new CSV) as `Refresh thesis snapshot to <short-sha>` and deploy. See `Initial_plan.md` §3.1.

## Local acceptance checks (MVP definition of done)

`Initial_plan.md` §9 lists six checks. The MVP is not done until all six pass on the live domain:

1. Password gate accepts/rejects correctly.
2. Thesis question answered from TeX content **with `[thesis: …]` citations the frontend renders as references**.
3. Code question (e.g. FFN type resolution between standard/KAN/MoE) answered from real code via `repo_grep`/`repo_read`, not guessed, **with `[code: path:lines]` citations linking to the pinned submodule blob**.
4. W&B question (e.g. median test AUROC for `d256_L6` grouped by B1) answered from the frozen CSV with correct group counts **and a `[wandb: …]` citation showing the resolved filter set and N**.
5. PDF loads in the viewer.
6. Axis lookup (e.g. "what does A3 control and where in the code?") resolves alias → config key → file location, citing both.
7. A question whose answer is not in any tool-grounded source gets a refusal, not a hallucination — verifies the citation contract is enforced rather than just hoped-for.
