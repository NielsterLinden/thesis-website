# Thesis Companion — backend (Step 3)

NestJS orchestrator for the password-gated thesis companion. It holds every
secret, runs the Anthropic agent loop, and exposes the four MVP tools. See
`../Initial_plan.md` §5 for the contract this implements.

## Run

```bash
# from backend/
npm install
npm run build          # tsc via nest build -> dist/
npm run start:dev      # watch mode on PORT (default 8080)
npm test               # jest: tool unit tests against the real frozen data
```

Secrets come from `../.env` (git-ignored; see `../.env.example`). Paths to the
thesis submodule, the CSV, and the PDF are resolved relative to the repo root
and are env-overridable (`THESIS_SRC_DIR`, `DATA_CSV_PATH`, `WEB_DIR`,
`THESIS_PDF_PATH`, `AXES_REFERENCE_PATH`, `APP_ROOT`).

## Endpoints

- `POST /chat` — gated (rate-limit → `x-site-password`). Body
  `{ "messages": [{ "role": "user"|"assistant", "content": string }] }` (the
  client holds history; the server is stateless). Returns
  `{ answer, stop_reason, tool_calls, usage, capped }`. `answer` carries inline
  citations the frontend renders as references.
- `GET /thesis.pdf` — the compiled thesis (ungated public artifact).
- `GET /health` — metadata only (prefix token count, tool count); no content.

## Tools (`src/tools/`)

| tool | what it does | citation it emits |
|------|--------------|-------------------|
| `repo_grep` / `repo_read` | search/read the pinned `thesis-src` submodule; path-confined, byte/match-capped | `[code: path:lines]` |
| `wandb_query` | filter+aggregate the frozen CSV; structured triples only, median across seeds | `[wandb: filters, N=…, agg]` |
| `axes_lookup` | resolve a V2 axis alias → config key / CSV column / report-spec key / code Note | `[axes: ID = key (AXES_REFERENCE_V2.md)]` |

`thesis_context` is **not** a tool: the full thesis TeX is loaded once into the
cached prompt prefix (Initial_plan.md §5.3), so thesis-content questions are
answered directly and cited as `[thesis: §…]`.

## Load-bearing decisions

- **Static prefix caching is mandatory.** System prompt + ~91k tokens of thesis
  TeX + the axes reference are sent as `system` blocks with a single
  `cache_control` breakpoint on the last block (caching tools + system together,
  since render order is tools → system → messages). A second breakpoint marks
  the last conversation message so tool round-trips cache too (≤ 2 of the 4
  allowed breakpoints). Without caching, per-turn cost on Opus 4.7/4.8 is ~10×.
- **The conversation-input cap counts `usage.input_tokens` only.** With caching,
  the static prefix is billed under `cache_read`/`cache_creation`, not
  `input_tokens`. So accumulating `input_tokens` across the loop bounds exactly
  the *conversation + tool-output* growth — what `MAX_CONVERSATION_INPUT_TOKENS`
  is meant to backstop — while the static knowledge base never trips it.
- **Adaptive thinking, not temperature.** Opus 4.7/4.8 reject
  `temperature`/`top_p`/`budget_tokens` (400); the loop uses
  `thinking: {type:"adaptive"}` + `output_config.effort`.
- **Telemetry is metadata only** (`src/telemetry.ts`): request id, timestamp,
  auth-ok, tool *names*, token counts, status. No question text, thesis content,
  or completions ever reach a log.
- **Citation contract is enforced in the system prompt** (`src/agent/system-prompt.ts`):
  every factual claim carries a `[thesis:]`/`[code:]`/`[wandb:]`/`[axes:]` anchor,
  and the model refuses rather than fabricate when nothing grounds an answer.
