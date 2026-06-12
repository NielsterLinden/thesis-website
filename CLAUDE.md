# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status: MVP + Phase 2 built; Render Blueprint instance and the §10 live save still pending

Steps 1–6 of `Initial_plan.md` are built and on `main`: scaffolding + pinned `thesis-src` submodule + frozen CSV + PDF, the NestJS backend (agent loop, auth guard, four MVP tools, jest tests against the real frozen data), the Vite/React frontend with citation chips, and the Docker image. All seven §9 acceptance checks passed locally under `docker compose` with live model calls. Phase 2 (report authoring, plan §6) is also built: `backend/src/reports/spec.ts` (schema + validator), `author_report` (validates + proposes, never saves; the spec rides to the browser on `ChatResult.report_proposal`, outside the model's text), the confirm card in `web/src/components/ReportConfirm.tsx`, gated `POST /reports/save` re-validating and spawning `sidecar/render_report.py` (`wandb-workspaces`, `save(draft=True)`), and python3+pip in the Docker runtime stage. Phase 2 stays dormant unless `WANDB_ENTITY`+`WANDB_SOURCE_PROJECT` hold real values (placeholders keep `reportsEnabled` false). Remaining: the user creates the Render Blueprint instance, re-runs §9 against the live URL, and runs `python sidecar/smoke_test.py --save` once (the §10 write-path verification — the read half already passed, see below). Read `Initial_plan.md` before doing structural work; it is the source of truth for the architecture, file layout, build order, and deployment steps.

Examiner-verifiability layer (built 2026-06-12, branch `worktree-landing-actions-emdash`): citations are now executable, not decorative. `[thesis: §4.2 / Eq. (6.1) / fig:…]` chips deep-link into the PDF via `#nameddest` (anchor map built at startup by `backend/src/thesis-anchors.ts` from the submodule's committed `report.toc`/`report.aux` — same latexmk run as `web/thesis.pdf`; served ungated at `/thesis-anchors.json`; Safari ignores PDF fragments and degrades to page 1). `wandb_query` ships its aggregate as `ToolResult.queryResult` (same side-channel pattern as `proposal`), surfaced on `ChatResult.query_results` and rendered as collapsible table+bar panels (`web/src/components/QueryResults.tsx`); clicking a `[wandb: …]` chip jumps to its panel (the prompt now shows the tool's exact citation shape so chips match attachments byte-for-byte). Equations render via remark-math+rehype-katex (prompt instructs `$…$`/`$$…$$`, no bare `$` for currency). `POST /chat/stream` (ndjson: `tool_start` events + terminal `final` carrying the /chat payload; `/chat` itself unchanged) feeds a live progress log in the chat placeholder — verify stream pass-through on Render at deploy. The landing page has a guided tour (`web/src/tour.json`, 6 real Haiku answers committed; regenerate with `node backend/scripts/generate-tour.mjs` against a running backend — it needs SITE_PASSWORD and retries filler openers), and chat has an Export-.md button. The no-em-dash style rule is now enforced server-side in `finalize()` (`stripEmDashes`, code spans exempt), not just prompted.

Inline thesis panel + W&B browse links (2026-06-12, second increment on the same branch): in chat, `[thesis: …]` chips no longer open a new tab — they dock an inline PDF.js panel beside the chat (`web/src/components/ThesisPanel.tsx`, lazy chunk via `web/src/pdfjs.ts`, loaded on first click only) that resolves the hyperref named destination itself and renders the cited page (sections, figures, equations) identically in every browser. This exists because native viewers disagree about `#nameddest` fragments (Edge ignores them → page 1); verified exhaustively that all 180 unique dests in the anchor map exist in the PDF name tree, so PDF.js resolution never misses. The tour (no panel on the landing page) keeps `#nameddest` new-tab links. The Vite dev proxy now forwards `/thesis-anchors.json` (it was missing — under `npm run dev` the anchor map silently failed to load and every chip fell back to page 1). The system prompt gains a gated LIVE W&B PROJECT section (same placeholder check as `/meta`): the model may hand out exactly the runs-table and reportlist URLs and must never construct per-run/per-report links. The tour's refusal card now asks about a published paper (on-topic) instead of the EUR/USD exchange rate; regenerate a single card with the splice pattern rather than a full tour run.

Implementation notes that refine the plan: the thesis TeX is **not** a callable tool — the full TeX loads once into the cached `system` prefix (measured 110,792 tokens under Haiku 4.5; ~148k under Opus 4.7's denser tokenizer — far above the plan's 30–40k estimate), so the callable tools are `repo_grep`, `repo_read`, `wandb_query`, `axes_lookup`, plus `author_report` when Phase 2 is enabled. The conversation-input cap counts `usage.input_tokens` only (cached prefix bills as cache reads, so the prefix never trips the cap). Opus 4.7/4.8 reject `temperature`/`budget_tokens`; the loop uses adaptive thinking plus an effort knob (`ANTHROPIC_EFFORT`, code default `high`; `none` omits both params — required for Haiku 4.5, which 400s on either). The Anthropic SDK must be ≥0.102 for those types.

Phase 2 ground truth established 2026-06-11 (read-only, via the author's local W&B credentials): entity `nterlind-nikhef`, canonical project `thesis-ml` (~1787 runs ≈ the frozen CSV's 1785 rows), and **live W&B config keys have the same form as the CSV columns** (`axes/B1_Bias Activation Set`; the CSV export only adds a `config/` prefix) — so the spec form `config:axes/<ID>_<Name>.value` derived by `toReportSpecKey` is correct and no remapping is needed. The W&B MCP server was evaluated and rejected for the save path (its `create_wandb_report_tool` auto-publishes — no draft mode — and has no groupby/median support); `wandb-workspaces` `expr.Config`/`expr.Summary` typed constructors build the filters, `Runset.groupby` takes `config.<path>` strings, and `GroupAgg` includes `median`. The W&B backend has no strict inequalities: `>`/`<` render as `>=`/`<=` in saved reports.

## What we are building

A password-gated companion site for a thesis (TeX + compiled PDF), its codebase, and a frozen Weights & Biases experiment export. **One LLM agent with several tool surfaces, not three separate systems.** Anthropic is called as a hosted endpoint; we host only a thin orchestrator.

```
React (static) -> NestJS backend -> Anthropic API
                       |              (thesis TeX + axes reference live in
                       |               the cached system prefix, not a tool)
                       +-- tools: repo_grep/read,
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
- **The frozen CSV is the database; the backend reads the lean derivative.** `data/04_thesis_final.csv` (34.5 MB) is the archival export; `data/04_thesis_final_lean.csv` (2.7 MB, generated by `node backend/scripts/make-lean-csv.mjs`) drops the six array-payload columns (ROC/PR curves, score histograms — ~93% of the bytes, unusable by a scalar aggregator) and is what `wandb_query` loads in-process **and** what `GET /runs.csv` serves for download — so a downloaded copy reproduces every `[wandb: …]` citation. There is no live W&B read path and no MCP subprocess for queries.
- **Thesis (~50 pages, ~30–40k tokens) is loaded whole into context — not RAG.** Same for the codebase: access is agentic grep/read over the `thesis-src` submodule, not embeddings. The questions here are explanatory ("how and why was X done") — the regime where reading real code beats retrieving snippets.
- **Prompt caching on the static prefix is mandatory.** System prompt + thesis TeX + axes reference are marked with `cache_control` on every `/chat` call. Deployed model is Haiku 4.5 (`claude-haiku-4-5` + `ANTHROPIC_EFFORT=none`, chosen 2026-06-11 for cost: with the render.yaml caps one question is bounded at ~$0.50 worst case, ~$0.03–0.15 typical); the code default remains `claude-opus-4-7`. Without caching the cost is ~10x higher per turn and the spend cap stops being a comfortable ceiling.
- **Every answer cites its sources.** Tool returns carry anchors; the system prompt requires the model to emit citation tokens (`[thesis: §4.2, Eq. (4.7)]`, `[code: path:lines]`, `[wandb: filters, N=N, median]`) and to refuse rather than fabricate when no tool-grounded evidence exists. The frontend renders these as verifiable references. This is the load-bearing trust property for an examiner-facing tool.
- **The report spec is library-agnostic JSON.** Claude emits intent; only `sidecar/render_report.py` knows that `wandb-workspaces` exists. When the Public Preview API shifts, patch one Python file, not the model prompt.
- **Report authoring is the only Python.** The image now installs python3 + `sidecar/requirements.txt`; the interpreter runs only when `/reports/save` spawns `sidecar/render_report.py` — nothing else may import or shell out to Python.
- **Stateless backend.** No sessions, no users table. The browser holds chat history; the server validates a shared-password header on every `/chat`.
- **`thesis-src` is a pinned git submodule.** The site reflects a specific snapshot of code+TeX, not a moving branch — this is an examiner-facing artifact.

## Phasing

- **MVP**: thesis-in-context, repo grep/read, frozen-CSV W&B queries, axes lookup, shared-password auth, static PDF.
- **Phase 2 (additive)**: `author_report` tool + Python sidecar + confirm-gate UI for drafting W&B reports.

Both phases are built; Phase 2 self-disables without real `WANDB_*` values, so the deploy order (MVP live first, then enable reports after the §10 smoke test) is an env-var decision, not a code branch.

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
- Use a **dedicated, spend-capped Anthropic key** for this site, not a personal key. Starting cap: $50/month — Haiku 4.5 with prompt caching across ~3 examiners visiting a handful of times keeps actual spend far below this (~$0.03–0.15 per question warm-cache); a leaked password hits the ceiling quickly.
- `ANTHROPIC_MODEL` defaults to `claude-opus-4-7` in code; the deploy env (render.yaml, `.env`) pins `claude-haiku-4-5`, which **requires** `ANTHROPIC_EFFORT=none` — the two must move together (Haiku 400s on adaptive thinking/effort; going back to Opus, restore `effort=high` and relax the caps). Verify model strings in the Anthropic docs at deployment time rather than hardcoding from memory.
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
- **Thesis-refresh workflow** (when the submodule snapshot bumps): in `thesis-src/` check out the new commit, drop in a refreshed `data/04_thesis_final.csv` if the run set changed and regenerate the lean file with `node backend/scripts/make-lean-csv.mjs`, regenerate the landing-page tour with `node backend/scripts/generate-tour.mjs` (answers and PDF anchors go stale with the snapshot; the refreshed PDF must come with its `report.toc`/`report.aux` or deep links degrade — startup logs a warning), re-run the §9 acceptance checks under `docker compose up`, then commit the bumped submodule pointer (+ both CSVs + `web/src/tour.json`) as `Refresh thesis snapshot to <short-sha>` and deploy. See `Initial_plan.md` §3.1.

## Local acceptance checks (MVP definition of done)

`Initial_plan.md` §9 lists six checks. The MVP is not done until all six pass on the live domain:

1. Password gate accepts/rejects correctly. (Since the landing-page upgrade the gate scopes to the assistant: the start page, PDF viewer, and CSV download are public; entering Chat prompts for the password. The server contract — gated `/chat`, `/auth/check` — is unchanged.)
2. Thesis question answered from TeX content **with `[thesis: …]` citations the frontend renders as references**.
3. Code question (e.g. FFN type resolution between standard/KAN/MoE) answered from real code via `repo_grep`/`repo_read`, not guessed, **with `[code: path:lines]` citations linking to the pinned submodule blob**.
4. W&B question (e.g. median test AUROC for `d256_L6` grouped by B1) answered from the frozen CSV with correct group counts **and a `[wandb: …]` citation showing the resolved filter set and N**.
5. PDF loads in the viewer.
6. Axis lookup (e.g. "what does A3 control and where in the code?") resolves alias → config key → file location, citing both.
7. A question whose answer is not in any tool-grounded source gets a refusal, not a hallucination — verifies the citation contract is enforced rather than just hoped-for.
