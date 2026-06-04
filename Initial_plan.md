# Thesis Companion: Build and Deployment Plan

A password-gated website that lets a small number of supervisors and examiners
interact with three sources at once through an LLM:

1. The thesis (TeX source plus the compiled PDF).
2. The codebase (the Hydra-driven transformer workbench, plus its docs).
3. The Weights & Biases experiment database (frozen), including the ability to
   author new W&B reports from natural language.

This document is the founding runbook for the repo. It is ordered as a sequence
of steps: local Docker development, secrets, local testing under Docker,
domain, and deployment. Follow it top to bottom.

---

## 0. Architecture at a glance

This is **one LLM agent with several tool surfaces**, not three separate
systems. There is no model hosting on our side: the Anthropic API is a hosted
endpoint we call over HTTPS with a key. We host only a thin orchestrator.

```
                         our-domain (e.g. thesis-companion.dev)
                                   |  HTTPS, auto TLS
                                   v
        +-------------------------------------------------------------+
        |  ONE Docker service (Railway or Render)                      |
        |                                                              |
        |  React frontend (built to static, served by Nest)            |
        |                                                              |
        |  NestJS backend  -- holds ALL secrets, never the browser     |
        |    POST /chat        (password-gated, runs the agent loop)    |
        |    GET  /thesis.pdf  (static file)                            |
        |    Anthropic SDK  -> api.anthropic.com                        |
        |    Tools (server-side):                                       |
        |      - thesis_context : read ./thesis-src TeX into context    |
        |      - repo_grep / repo_read : search/read ./thesis-src       |
        |      - wandb_query    : read the FROZEN CSV (no live W&B)      |
        |      - axes_lookup    : V2 alias <-> config key <-> wandb key  |
        |      - author_report  : emit a semantic JSON report spec       |
        |                              |                                 |
        |                              v   (subprocess, stdin/stdout)    |
        |  Python sidecar : JSON spec -> wandb-workspaces -> .save()     |
        |                              |     (draft only)                |
        +------------------------------|-------------------------------+
                                       v
                                 api.wandb.ai
                       (READ from frozen canonical project;
                        WRITE only to thesis-visitor-reports)

   On disk:  ./thesis-src/  (git submodule: code + TeX)
             ./data/04_thesis_final.csv  (frozen W&B export)
             ./web/thesis.pdf            (compiled thesis)

   Secrets (env only):  ANTHROPIC_API_KEY, WANDB_API_KEY, SITE_PASSWORD
   No database.
```

Key design decisions, with the reasoning, so we do not relitigate them later:

- **No model hosting, no Azure AI Foundry, no GPU.** Direct Anthropic key is
  simpler and cheaper for a personal tool. Foundry exists for enterprise
  billing and compliance, which we do not need.
- **The frozen CSV is our database.** Because the W&B database is frozen, the
  query path reads a shipped CSV in-process. No live W&B, no MCP subprocess for
  reading. This keeps the read path pure TypeScript.
- **Report authoring is the only Python.** `wandb-workspaces` (the W&B report
  authoring library) is Python-only and in Public Preview. It lives in a small
  sidecar that does exactly one job. This is also why we need Docker (a Node
  plus Python runtime in one image).
- **The thesis (about 50 pages) is loaded whole into context, not RAG-ed.** At
  roughly 30k to 40k tokens it fits in one window. RAG would add retrieval
  error for no benefit.
- **Codebase access is agentic grep and read, not embedding RAG.** Our
  questions are explanatory ("how and why was X implemented"), which is the
  regime where reading real code beats retrieving snippets.
- **Prompt caching on the static prefix is mandatory, not an optimization.**
  The system prompt, the thesis TeX, and the axes reference are marked with
  `cache_control` on every `/chat` call. Default model is Opus 4.7
  (`claude-opus-4-7`); without caching, the cached-read discount is what
  makes the monthly spend cap a comfortable ceiling rather than a tight one.
  Costs are roughly an order of magnitude higher without it, and the cap math
  stops working.
- **Every answer cites its sources.** Tools return content tagged with
  anchors — `\section`/`\label{}` for the thesis, `file:line_start-line_end`
  for code, the resolved filter set and seed count for W&B, the source row
  for axes lookups. The system prompt requires the model to emit those
  anchors in a stable format (`[thesis: §4.2, Eq. (4.7)]`,
  `[code: backend/agent/loop.ts:42–58]`,
  `[wandb: B1=="GELU", H10=="d256_L6", N=8 seeds, median]`) and to refuse
  rather than fabricate when no tool-grounded evidence exists. The frontend
  renders these as verifiable references. This is the load-bearing trust
  property for an examiner-facing tool.
- **The report spec is a semantic, library-agnostic JSON contract.** Claude
  emits intent; the Python renderer is the only component that knows
  `wandb-workspaces` exists. When the Public Preview API shifts, we patch one
  Python file, not the model prompt.

### Scope and phasing

- **MVP**: thesis-in-context, repo grep/read, W&B read-query over the frozen
  CSV, axes lookup, shared-password auth, PDF served static. Every answer
  carries source citations the frontend renders as references. Deployed,
  domained, spend-capped.
- **Phase 2**: W&B report authoring (the Python sidecar), ROC-curve panels via
  custom charts, per-user tokens instead of a single password.

We will build the MVP end to end first, deploy it, then layer in authoring. The
repo and Docker image are designed from day one to accept the sidecar, so
adding Phase 2 is additive, not a rewrite.

---

## 1. Prerequisites (install locally)

- Git
- Docker Desktop (or Docker Engine plus Compose v2)
- Node.js LTS and npm (for local non-Docker iteration, optional but convenient)
- A code editor (Cursor is our agent environment)
- Accounts and access:
  - Anthropic Console account (for the API key and spend cap)
  - The existing Weights & Biases account (for the write key, Phase 2)
  - A GitHub account (the deploy target connects to a GitHub repo)
  - A registrar account for the domain (Cloudflare or Namecheap)

You do not need a cloud account for the model, a GPU, or a Kubernetes anything.

---

## 2. Repository layout

The web app is its own new repo. The thesis repo (code plus TeX) is pulled in as
a git submodule pinned to a known commit, so the site always reflects a specific
snapshot. Target layout:

```
thesis-companion/
  PLAN.md                      <- this document
  README.md
  docker-compose.yml
  Dockerfile
  .env.example                 <- committed; documents required vars
  .env                         <- git-ignored; real secrets, never committed
  .gitignore
  .gitmodules

  thesis-src/                  <- git submodule: the thesis+code repo
  data/
    04_thesis_final.csv        <- frozen W&B export (committed or pulled at build)

  backend/                     <- NestJS app
    package.json
    src/
      main.ts
      app.module.ts
      auth/                    <- shared-password guard
      agent/                   <- the Claude agent loop + tool dispatch
      tools/
        thesis-context.tool.ts
        repo-grep.tool.ts
        wandb-query.tool.ts
        axes-lookup.tool.ts
        author-report.tool.ts  <- Phase 2; emits JSON spec, calls sidecar
      reports/
        schema.ts              <- the report-spec type + validator
    (axes reference is read from the submodule, not duplicated here — see §3)

  sidecar/                     <- Phase 2 Python report renderer
    render_report.py
    requirements.txt

  web/                         <- React frontend (built to static)
    package.json
    src/
    thesis.pdf                 <- compiled thesis, served static
```

Rationale for the submodule: the thesis repo keeps its own history and GitHub
home, and a submodule pins an exact commit. For an examiner-facing artifact we
want the site tied to a known snapshot of code and thesis, not a moving branch.

---

## 3. Step 1: Initialize the repo and add the thesis submodule

```bash
mkdir thesis-companion && cd thesis-companion
git init
# create .gitignore with at least: .env, node_modules/, dist/, web/dist/, *.log

# add the thesis+code repo as a submodule at ./thesis-src
git submodule add <thesis-repo-git-url> thesis-src
git submodule update --init --recursive

# pin to a specific commit (the snapshot the site should reflect)
cd thesis-src
git checkout <commit-sha-or-tag>
cd ..
git add .gitmodules thesis-src
git commit -m "Add thesis source as pinned submodule"
```

Place the frozen export at `data/04_thesis_final.csv`. If it is small (a few MB)
commit it; if you prefer not to, document a build step that copies it in. Place
the compiled `thesis.pdf` at `web/thesis.pdf`.

`AXES_REFERENCE_V2.md` lives inside the `thesis-src` submodule. `axes_lookup`
reads it from there rather than from a copy in `backend/`. The thesis is still
being iterated (a revised snapshot is expected), and a duplicate in this repo
would drift silently against the next snapshot. The file is the spine that
lets a single question resolve across all three sources, so the read path
must be tied to the pinned submodule commit.

### 3.1 Thesis-refresh workflow

The thesis is not yet final. Treat a snapshot bump as a deliberate operation,
not an improvised commit:

1. In `thesis-src/`, fetch and check out the new commit.
2. If the run set changed, replace `data/04_thesis_final.csv` with the new
   export.
3. From repo root, re-run the §9 acceptance checks under `docker compose up`.
   The axis-lookup check is the most likely failure mode, since the V2
   reference is where drift will hide.
4. If Phase 2 is in place, re-run the §10 smoke test against one real run
   from the new export to confirm `wandb-workspaces` still resolves the
   config-key syntax.
5. Commit the bumped submodule pointer (and the new CSV, if changed) as one
   commit titled `Refresh thesis snapshot to <short-sha>`. Document the SHA
   in the commit message and deploy — any examiner answer is then traceable
   to the exact snapshot it came from.

---

## 4. Step 2: Secrets, environment, and the spend cap

### 4.1 Create the `.env.example` (committed) and `.env` (git-ignored)

`.env.example`:

```
# Anthropic
ANTHROPIC_API_KEY=sk-ant-REPLACE_ME
ANTHROPIC_MODEL=claude-opus-4-7

# Site auth (single shared password for the MVP)
SITE_PASSWORD=choose-a-strong-shared-secret

# Per-conversation safety caps (the request-level backstop to the monthly cap)
MAX_CONVERSATION_INPUT_TOKENS=200000
MAX_TOOL_CALLS_PER_TURN=20

# Weights & Biases (Phase 2, report authoring only)
WANDB_API_KEY=REPLACE_ME
WANDB_ENTITY=your-wandb-entity
WANDB_SOURCE_PROJECT=your-frozen-canonical-project
WANDB_TARGET_PROJECT=thesis-visitor-reports

# Runtime
PORT=8080
NODE_ENV=development
```

Default `ANTHROPIC_MODEL` is `claude-opus-4-7` (Opus 4.7). The backend reads
the model from this variable so swapping is a config change, not a code
change — verify the current model string in the Anthropic docs at deployment
time rather than relying on a guess from memory.

`MAX_CONVERSATION_INPUT_TOKENS` and `MAX_TOOL_CALLS_PER_TURN` are the
per-request backstop. With no conversation transcripts persisted (§5.5),
these caps are the only thing standing between a runaway tool loop and the
monthly spend cap.

### 4.2 Create a dedicated, spend-capped Anthropic key

In the Anthropic Console:

1. Create a **new API key used only by this site** (not your personal key).
2. Set a **monthly usage limit** on it.

This is the real protection behind a shared password. A leaked password then
caps out at a known ceiling and the site stops answering, rather than running an
unbounded bill. Treat the limit like a HTCondor quota. For Opus 4.7 with prompt
caching, three examiners visiting a handful of times each, **$50/month** is a
reasonable starting cap — high enough that legitimate use never trips it, low
enough that a leak is bounded.

### 4.3 Scope the W&B key (Phase 2)

The W&B key on the server reads from the frozen canonical project and writes
only to `thesis-visitor-reports`. Never give this tool a key that can mutate the
namespace holding your thesis-of-record runs. Reports are always created as
drafts.

---

## 5. Step 3: The NestJS backend

Scaffold:

```bash
cd backend
npx @nestjs/cli new . --package-manager npm
npm install @anthropic-ai/sdk
```

Build these pieces (each is a separate Cursor prompt later; this section defines
the contract, not the full code):

### 5.1 Auth guard (`auth/`)
A Nest guard that compares an incoming header (for example
`x-site-password`) against `SITE_PASSWORD`. Applied to `/chat`. No sessions, no
users, no database. Optionally, on a correct password, issue a short-lived
stateless signed JWT so the password leaves the client after first use; this is
a nicety, not required for the MVP.

### 5.2 Agent loop (`agent/`)
The core handler for `POST /chat`:
1. Receive the conversation history from the client (the client holds history;
   the server is stateless).
2. Call the Anthropic Messages API with the system prompt and the tool
   definitions. **Mark the static prefix (system prompt + thesis TeX + axes
   reference) with `cache_control`** so the prompt cache absorbs the ~30–40k
   token thesis on every turn after the first. Without this, Opus 4.7 costs
   roughly ten times more per turn and the spend cap stops being comfortable.
3. When the model requests a tool, dispatch to the matching tool in `tools/`,
   return the result, and continue the loop until the model produces a final
   answer. Enforce two request-level caps inside the loop:
   `MAX_CONVERSATION_INPUT_TOKENS` (refuse to continue once accumulated input
   crosses it) and `MAX_TOOL_CALLS_PER_TURN` (refuse to start another tool
   roundtrip past it). With no transcripts persisted, these are the only
   per-request backstop against a runaway loop.
4. Stream or return the answer.

The system prompt encodes the role (research assistant for this thesis), the
instruction to reason in axis IDs, and the V2 alias mapping summary. Keep it
aligned with the project conventions: distinguish physics-motivated from
ML-motivated reasoning, prefer median over mean across seeds, treat
`<not_applicable>` as the conditional sentinel, and remember the continuous
feature index convention `[0,1,2,3] = [E, Pt, eta, phi]`.

It also enforces the **citation contract**: every factual claim about the
thesis, code, or runs must carry an inline reference token in a stable format
— `[thesis: §4.2, Eq. (4.7)]`, `[code: backend/agent/loop.ts:42–58]`,
`[wandb: B1=="GELU", H10=="d256_L6", N=8 seeds, median]`. If supporting
material is not present in tool output, the model declines rather than
guessing. The frontend detects these tokens and renders them as verifiable
references (§7). Acceptance check #7 in §9 exists specifically to catch
regressions where the model fabricates anchors instead of refusing.

### 5.3 Tools (`tools/`)

Every tool returns content with anchors the agent can cite. The system prompt
forbids un-cited factual claims, so a tool that returns anchor-free text is a
bug, not a quirk.

- **thesis_context**: reads the TeX from `./thesis-src` for in-context
  grounding. Prefer TeX over PDF so `\section{}` and `\label{}` markers stay
  readable for citation. The full TeX is loaded once at process start and
  lives in the cached prefix (§5.2), not on each call.
- **repo_grep / repo_read**: search and read files under `./thesis-src`.
  This is the codebase "how and why" surface. Constrain paths to the submodule
  directory — resolve absolute paths and reject anything that escapes,
  including via symlinks — so the tool cannot read outside it. Each result
  carries `path` and `line_start-line_end`. Cap `repo_grep` output (e.g. 200
  matches, 64 KB) so a broad pattern cannot flood the context.
- **wandb_query**: parses `data/04_thesis_final.csv` (<20 MB) once at process
  start into an in-memory table and serves filter+aggregation queries from
  it. The tool input is a **structured query** — filter triples
  `{field, op, value}` with `op` from the closed set
  (`==`, `!=`, `in`, `>`, `<`, `>=`, `<=`), plus optional `groupby` and
  `agg` (default `median`, honoring the across-seeds principle) — never a
  raw expression string the tool would `eval`. Returns include the resolved
  filter set and the N behind each cell so the agent can cite them. No
  network; read-only by construction.
- **axes_lookup**: given a V2 alias (B1, T1, A3), returns the formal config
  key, the W&B reference string, the relevant thesis section, and the source
  row in `AXES_REFERENCE_V2.md` so the agent can cite the mapping itself.
  Reads the reference directly from the `thesis-src` submodule (see §3) —
  not from a copy under `backend/`.
- **author_report** (Phase 2): see Step 4 below.

### 5.4 Static serving
Serve `web/dist` (the built React app) and `web/thesis.pdf` from Nest so the
whole thing is one service. This is the least to manage at our scale.

### 5.5 Telemetry policy

The server does not log conversation inputs or outputs — no transcripts, no
prompt bodies, no model completions. Operational telemetry is **metadata
only**: request id, timestamp, password-correct boolean, tool call names and
durations, input/output token counts, and final HTTP status. Stdout is the
sink — Railway and Render both surface recent logs, which is enough to spot
a runaway loop or a leaked password being hammered. Anything that would
contain examiner question text or thesis content stays out of logs by
construction.

---

## 6. Step 4: The Python report sidecar (Phase 2)

`sidecar/requirements.txt`:

```
wandb
wandb-workspaces
```

`sidecar/render_report.py` reads a JSON report spec on stdin, builds the
`wandb-workspaces` objects, saves a **draft** report to `WANDB_TARGET_PROJECT`,
and prints the report URL on stdout. Nest invokes it as a subprocess and passes
the spec through stdin. No second network port, no separate service.

The contract between Nest and Python is the **semantic report spec** in
`backend/reports/schema.ts`. Claude (via `author_report`) emits this spec;
`schema.ts` validates it; the sidecar renders it. Claude never writes Python and
never sees a `wandb-workspaces` symbol.

### 6.1 Panel vocabulary exposed (curated, mapped to the science)

| spec `kind`      | W&B class                 | Use                                            |
|------------------|---------------------------|------------------------------------------------|
| `scalar_by_axis` | ScalarChart (+ groupby)   | median AUROC per B1 / T1 / A3 setting          |
| `bar_by_axis`    | BarPlot                   | metric across one axis' discrete values        |
| `scatter`        | ScatterPlot               | AUROC vs num_parameters; latency vs AUROC      |
| `parallel_coords`| ParallelCoordinatesPlot   | multi-axis sweep to final AUROC (304-run set)  |
| `axis_importance`| ParameterImportancePlot   | quick native preview of the Ch.7 fANOVA/SHAP   |
| `line`           | LinePlot                  | training/val curves (x=epoch, y=val/auroc)     |

Known limitation: ROC curves are array-valued (`eval_v2/roc_fpr`,
`eval_v2/roc_tpr`) stored in per-run tables, not scalar summaries, so they are
not a `line` panel. ROC inside an authored report needs a custom-chart path,
deferred to a later Phase 2 increment.

### 6.2 The report-spec schema (the contract)

```jsonc
{
  "title": "string",
  "description": "string",
  "entity": "<wandb-entity>",
  "source_project": "<frozen canonical project>",   // runs READ from here
  "target_project": "thesis-visitor-reports",        // report WRITTEN here
  "runset": {
    "filters": [                                     // ANDed together
      { "field": "config:axes/H10_Model Size Label.value", "op": "==", "value": "d256_L6" }
    ],
    "groupby": ["config:axes/B1_Bias Activation Set.value"]
  },
  "blocks": [
    { "type": "heading", "text": "AUROC by physics-bias activation" },
    { "type": "prose",   "text": "Median across seeds; baseline held fixed." },
    { "type": "panel", "kind": "scalar_by_axis",
      "metric": "eval_v2/test_auroc",
      "groupby": "config:axes/B1_Bias Activation Set.value",
      "agg": "median" }
  ]
}
```

- `op` is a closed set: `==`, `!=`, `in`, `>`, `<`, `>=`, `<=`. The renderer maps
  each to the library's filter-expression constructor. Keeping filters as
  structured triples (not raw expression strings) makes the spec validatable and
  prevents arbitrary code from being smuggled through a filter.
- `agg` defaults to `median`, honoring the across-seeds principle.
- Two namespaces: summary metrics (the y-values, e.g. `eval_v2/test_auroc`) and
  config axes (the filter/groupby fields, addressed as `config:<path>.value`).
  `axes_lookup` resolves the V2 alias to the formal config key before the spec is
  built, so the stored spec is unambiguous.

### 6.3 The write gate (non-negotiable)
- Always create **draft**, never auto-publish.
- Always **confirm before save**, via a **two-call protocol** — not a
  next-user-turn "yes":
  1. `author_report` resolves the spec, runs the schema validator, and
     returns the validated spec plus a plain-language summary (panel type,
     metric, filters, group counts, target project). No `.save()` happens
     in this call.
  2. The frontend renders the summary and a confirm button. Clicking it
     POSTs the validated spec to a separate endpoint (`/reports/save`),
     which re-validates and invokes the sidecar.

  The model never authors the save. This makes the write gate a real
  security boundary rather than a prompt the model can be talked past.
- The W&B key writes only to `thesis-visitor-reports`.

---

## 7. Step 5: The React frontend

```bash
cd web
npm create vite@latest . -- --template react-ts
npm install
```

Minimum for the MVP:
- A password entry box; the password is held in `sessionStorage` and sent as a
  header on each `/chat` request, so it is typed once per visit.
- A chat view; conversation history lives in browser state (no server storage).
- **Citation rendering.** Parse inline citation tokens in assistant messages
  (`[thesis: …]`, `[code: …]`, `[wandb: …]`) and render them as references:
  code citations link to the GitHub blob at the pinned submodule SHA with
  the line range; thesis citations show the section/label and an "open
  thesis" link to `/thesis.pdf` (TeX→PDF page mapping is out of scope for
  MVP — ctrl-f for the section name is acceptable); W&B citations show the
  filter set and N inline. Un-cited factual claims should look visibly
  weaker than cited ones so examiners can tell at a glance.
- A PDF view (an `<embed>` or a viewer component pointed at `/thesis.pdf`).
- Phase 2: when the agent proposes a report, render the confirm summary and
  a confirm button. The button POSTs the validated spec to `/reports/save`
  (not `/chat`) — see the two-call protocol in §6.3 — and on success shows
  the returned report URL.

Do not put any secret in the frontend. The frontend talks only to our backend;
the backend holds every key.

Build output goes to `web/dist`, which Nest serves.

---

## 8. Step 6: Dockerize

We need Node and (for Phase 2) Python in one image. This is the polyglot case
where Docker earns its place.

`Dockerfile` (multi-stage sketch):

```dockerfile
# --- build frontend ---
FROM node:lts AS web-build
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build            # outputs web/dist

# --- build backend ---
FROM node:lts AS api-build
WORKDIR /backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build            # outputs backend/dist

# --- runtime: node + python ---
FROM node:lts
RUN apt-get update && apt-get install -y python3 python3-pip git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# backend runtime deps
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev

# python sidecar deps (Phase 2)
COPY sidecar/requirements.txt ./sidecar/
RUN pip3 install --no-cache-dir --break-system-packages -r sidecar/requirements.txt

# app artifacts
COPY --from=api-build /backend/dist ./backend/dist
COPY --from=web-build /web/dist ./web/dist
COPY backend/reference ./backend/reference
COPY sidecar ./sidecar
COPY data ./data
COPY web/thesis.pdf ./web/thesis.pdf
# thesis-src is provided via submodule checkout in CI/deploy, or COPY it in

EXPOSE 8080
CMD ["node", "backend/dist/main.js"]
```

`docker-compose.yml` (local dev convenience):

```yaml
services:
  app:
    build: .
    ports:
      - "8080:8080"
    env_file:
      - .env
    volumes:
      - ./thesis-src:/app/thesis-src:ro    # live repo for grep/read in dev
      - ./data:/app/data:ro
```

For the MVP you can omit the Python install lines and the sidecar copy; add them
when you start Phase 2.

---

## 9. Step 7: Run and test locally with Docker

```bash
# from repo root, with .env filled in
docker compose build
docker compose up
# open http://localhost:8080
```

Local acceptance checks (MVP):
1. The site loads and asks for the password; a wrong password is rejected.
2. Ask a thesis question ("summarize the input representation chapter"); the
   answer reflects the TeX content **and includes `[thesis: …]` citations
   that the frontend renders as references**.
3. Ask a code question ("how is the FFN type resolved between standard, KAN,
   and MoE?"); the answer reflects real code, not a guess, **and carries
   `[code: path:lines]` citations linking to the pinned submodule blob**.
   Exercises repo_grep/read and the citation contract.
4. Ask a W&B question ("median test AUROC for the d256_L6 baseline grouped by
   B1"); the answer comes from the frozen CSV with correct group counts **and
   a `[wandb: …]` citation showing the resolved filter set and the N behind
   each value**.
5. Open the PDF in the viewer.
6. Ask an axis question ("what does A3 control and where in the code?"); the
   answer resolves the alias to the config key and the file, **citing both
   the axes-reference row and the code location**. Exercises axes_lookup and
   the citation contract.
7. Ask a question whose answer is not present in any tool-grounded source;
   the agent declines rather than guessing. This verifies the system prompt
   actually enforces the citation contract — without this check, a regression
   to fabricated anchors would pass #2–#6.

Iterate locally until all six pass. Only then move to deployment.

---

## 10. Step 8: Pre-deploy verification for report authoring (Phase 2)

Before building the renderer, confirm two version-sensitive strings against one
real run, because getting them wrong is the most likely failure mode and the
`wandb-workspaces` API is in Public Preview:

1. **The config-key reference syntax.** Pull one run via the W&B Public API and
   confirm the literal key path for an axis (for example whether it is
   `config:axes/B1_Bias Activation Set.value` or a dotted variant). Hardcode the
   confirmed form in the renderer.
2. **The filter-expression constructor.** Verify the exact way v2 filters are
   built (the typed expression form), since the schema uses structured triples
   that the renderer must translate.

Do this with a roughly 30-line smoke-test script that creates one trivial draft
report in `thesis-visitor-reports` with a single `scalar_by_axis` panel filtered
to the baseline. Once those two strings are confirmed, the renderer is
mechanical.

---

## 11. Step 9: Get a domain

1. Buy a domain at Cloudflare Registrar or Namecheap. A `.dev` or `.app` is a
   reasonable choice (both force HTTPS, which suits us) and runs on the order of
   a low double-digit euro figure per year. Cheaper TLDs exist if cost matters.
2. Keep DNS at the registrar for now; we will add a record pointing at the host
   in Step 11.

Verify current pricing in the registrar dashboard at purchase time, since
registrar promotions shift.

---

## 12. Step 10: Deploy

Primary path is **Railway** because its usage-based, scale-to-zero billing fits
an idle-most-of-the-time examiner tool and onboarding is the simplest. **Render**
is the alternative if you prefer flat, predictable monthly pricing. Both deploy
from a GitHub repo and both run a Dockerfile.

1. Push the repo to GitHub. Ensure CI (or the platform build) runs
   `git submodule update --init --recursive` so `thesis-src` is present, or COPY
   the checked-out submodule into the image.
2. Create a new project on the chosen platform and connect the GitHub repo.
3. Set the build to use the Dockerfile.
4. Add all environment variables from `.env` in the platform dashboard (the
   spend-capped Anthropic key, `SITE_PASSWORD`, and the W&B vars for Phase 2).
   Never commit real secrets; they live only in `.env` locally and in the
   platform's secret store in production.
5. Deploy and confirm the service starts and serves on its platform URL.

Note on scale-to-zero: after an idle period the first request incurs a short
cold start (a second or two before the first reply). For a chat tool this is
harmless.

---

## 13. Step 11: Wire the domain and TLS

1. In the platform, add the custom domain to the service.
2. At the registrar, create the DNS record the platform specifies (typically a
   CNAME) pointing the domain at the platform host.
3. The platform provisions TLS automatically. Wait for the certificate to issue,
   then confirm `https://your-domain` loads the site.

Re-run the six local acceptance checks against the live domain.

---

## 14. Security checklist

- [ ] Dedicated Anthropic key with a monthly spend cap (not a personal key).
      Starting value: $50/month for Opus 4.7 with prompt caching.
- [ ] All secrets in env or the platform secret store; none in the repo or the
      frontend. `.env` is git-ignored.
- [ ] Auth guard on `/chat`; wrong password rejected.
- [ ] In-memory per-IP rate limit on `/chat` (the leaked-password backstop
      between billing checks). The site runs as a **single instance**
      (`max_instances = 1`) — the in-memory counter does not survive a
      second replica, and horizontal scaling is not on the roadmap.
- [ ] Per-conversation token and tool-call caps enforced in the agent loop
      (`MAX_CONVERSATION_INPUT_TOKENS`, `MAX_TOOL_CALLS_PER_TURN`). With no
      transcripts persisted, these are the only per-request backstop.
- [ ] Anthropic prompt caching enabled on the static prefix (system prompt +
      thesis TeX + axes reference). Without this the spend cap math does not
      hold for Opus 4.7.
- [ ] repo_grep/read constrained to the `thesis-src` directory (resolve
      absolute paths, reject symlink escapes). `repo_grep` capped on match
      count and bytes returned.
- [ ] `wandb_query` accepts structured filter triples only — never raw
      expression strings to be `eval`'d.
- [ ] Citation contract enforced in the system prompt; un-cited factual
      claims are a regression caught by acceptance check #7.
- [ ] No conversation inputs/outputs in logs — only metadata (request id,
      timestamp, tool names, token counts, status).
- [ ] W&B key scoped to write only `thesis-visitor-reports`; reads from the
      frozen project.
- [ ] Report authoring always drafts; confirm-before-save uses the two-call
      protocol (`/reports/save` separate from `/chat`).
- [ ] HTTPS enforced (the platform and a `.dev`/`.app` TLD both push this).

---

## 15. Definition of done

**MVP done** when, on the live domain behind the password, a supervisor can:
ask thesis questions answered from the TeX, ask code questions answered from
real code, ask W&B questions answered from the frozen CSV with correct
aggregation, resolve any axis to its config key and code location, and view the
PDF. Spend is capped and secrets are clean.

**Phase 2 done** when a supervisor can describe a desired comparison in natural
language, review a plain-language summary of the resolved report spec, confirm,
and receive a URL to a draft W&B report in `thesis-visitor-reports` with the
requested panels and filters.

---

## Appendix A: Build order summary

1. Init repo, add thesis submodule, drop in the CSV, PDF, and axes reference.
2. Secrets and the spend-capped Anthropic key.
3. NestJS backend: auth guard, agent loop, the four MVP tools, static serving.
4. React frontend: password box, chat, PDF viewer.
5. Dockerfile and compose (Node only for MVP).
6. Local Docker testing; pass the six acceptance checks.
7. Domain purchase.
8. Deploy to Railway (or Render), set env vars, confirm.
9. Wire domain and TLS; re-test live.
10. Phase 2: pre-deploy W&B verification, Python sidecar, report-spec schema and
    validator, `author_report` tool, confirm-gate UI.

## Appendix B: Conventions carried from the thesis project

- Reason in axis IDs (B1, T1, A3, D2, and so on). Keep physics-motivated and
  ML-motivated reasoning explicitly distinct.
- Median, not mean, across seeds, especially with structural outliers.
- `<not_applicable>` is the literal sentinel for conditional axes, not NaN.
- Continuous feature index convention: `[0,1,2,3] = [E, Pt, eta, phi]`. Energy
  is index 0, Pt is index 1. Not four-momentum.
- The V2 axis aliases are a thesis-facing presentation layer; the frozen
  canonical IDs are not changed. `axes_lookup` holds the mapping.