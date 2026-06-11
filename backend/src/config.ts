import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as dotenv from 'dotenv';

/**
 * Centralised, typed view of the environment. Read once at process start.
 *
 * Path resolution: every on-disk artifact (the thesis submodule, the frozen
 * CSV, the built frontend, the PDF) is addressed relative to APP_ROOT, which
 * defaults to the repo root two levels above this file:
 *   - dev (ts-node):  backend/src/config.ts  -> ../.. = repo root
 *   - prod (compiled): backend/dist/config.js -> ../.. = repo root
 * In the Docker image (Initial_plan.md §8) WORKDIR is /app and the artifacts
 * sit at /app/thesis-src, /app/data, /app/web — so APP_ROOT resolves to /app.
 * Each path is individually overridable for unusual layouts.
 */

const APP_ROOT = process.env.APP_ROOT
  ? resolve(process.env.APP_ROOT)
  : resolve(__dirname, '..', '..');

// Load .env from the repo root if present. dotenv does NOT override variables
// already set in the environment, so the platform secret store (Render) wins
// in production and the local .env wins in dev. A missing file is a no-op.
const envFile = resolve(APP_ROOT, '.env');
if (existsSync(envFile)) {
  dotenv.config({ path: envFile });
}

function str(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    return '';
  }
  return v;
}

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export interface AppConfig {
  // Anthropic
  anthropicApiKey: string;
  /**
   * Default kept at claude-opus-4-7 to match Initial_plan.md §4.1 and the
   * committed .env.example. The plan mandates reading this from env so a model
   * swap is a config change, not a code change. claude-opus-4-8 is current at
   * the same price ($5/$25 per 1M, 1M context) and more capable — bump
   * ANTHROPIC_MODEL in the deployment env to adopt it without a redeploy of code.
   */
  anthropicModel: string;
  /**
   * Opus 4.7/4.8 use adaptive thinking + an effort knob instead of
   * temperature/budget_tokens (those now 400). effort is the single biggest
   * cost lever on this model family; "high" is the API default. Tunable here
   * so cost can be dialled without a code change. "none" omits the thinking
   * and effort params entirely — required for models without adaptive-thinking
   * support (e.g. claude-haiku-4-5, which 400s on either param).
   */
  anthropicEffort: 'none' | 'low' | 'medium' | 'high' | 'max';

  // Auth
  sitePassword: string;

  // Per-request safety caps (the only per-request backstop to the monthly cap;
  // see Initial_plan.md §5.2 — no transcripts are persisted).
  maxConversationInputTokens: number;
  maxToolCallsPerTurn: number;

  // Generation
  maxOutputTokens: number;

  // Rate limiting (the leaked-password backstop between billing checks, §14).
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;

  // Runtime
  port: number;
  nodeEnv: string;

  // On-disk artifacts
  appRoot: string;
  thesisSrcDir: string;
  dataCsvPath: string;
  webDir: string;
  thesisPdfPath: string;
  axesReferencePath: string;

  // Pinned submodule SHA + GitHub repo, used to build [code: …] citation links
  // that point at the exact frozen blob the answer was grounded in.
  submoduleSha: string;
  submoduleRepoUrl: string;

  // Phase 2: W&B report authoring (Initial_plan.md §6). The agent only emits a
  // validated spec; the sidecar holds the only W&B write path. Authoring is
  // enabled when entity + source project are configured — without them the
  // author_report tool is not registered and /reports/save refuses.
  wandbApiKey: string;
  wandbEntity: string;
  wandbSourceProject: string;
  /** The ONLY project reports are written to (§4.3) — never the canonical one. */
  wandbTargetProject: string;
  /** Python interpreter for the sidecar ("python3" in the image; "python" on Windows dev). */
  pythonBin: string;
  reportsEnabled: boolean;
}

/** Placeholder values from .env.example must not flip features on. */
export function isPlaceholder(v: string): boolean {
  return v === '' || v.startsWith('REPLACE') || v.startsWith('your-');
}

let cached: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cached) return cached;

  const thesisSrcDir = process.env.THESIS_SRC_DIR
    ? resolve(process.env.THESIS_SRC_DIR)
    : resolve(APP_ROOT, 'thesis-src');

  const effortRaw = str('ANTHROPIC_EFFORT', 'high');
  const effort = (['none', 'low', 'medium', 'high', 'max'].includes(effortRaw)
    ? effortRaw
    : 'high') as AppConfig['anthropicEffort'];

  cached = {
    anthropicApiKey: str('ANTHROPIC_API_KEY'),
    anthropicModel: str('ANTHROPIC_MODEL', 'claude-opus-4-7'),
    anthropicEffort: effort,

    sitePassword: str('SITE_PASSWORD'),

    maxConversationInputTokens: int('MAX_CONVERSATION_INPUT_TOKENS', 200_000),
    maxToolCallsPerTurn: int('MAX_TOOL_CALLS_PER_TURN', 20),

    maxOutputTokens: int('MAX_OUTPUT_TOKENS', 8_192),

    rateLimitWindowMs: int('RATE_LIMIT_WINDOW_MS', 60_000),
    rateLimitMaxRequests: int('RATE_LIMIT_MAX_REQUESTS', 30),

    port: int('PORT', 8_080),
    nodeEnv: str('NODE_ENV', 'development'),

    appRoot: APP_ROOT,
    thesisSrcDir,
    dataCsvPath: process.env.DATA_CSV_PATH
      ? resolve(process.env.DATA_CSV_PATH)
      : resolve(APP_ROOT, 'data', '04_thesis_final.csv'),
    webDir: process.env.WEB_DIR ? resolve(process.env.WEB_DIR) : resolve(APP_ROOT, 'web'),
    thesisPdfPath: process.env.THESIS_PDF_PATH
      ? resolve(process.env.THESIS_PDF_PATH)
      : resolve(APP_ROOT, 'web', 'thesis.pdf'),
    axesReferencePath: process.env.AXES_REFERENCE_PATH
      ? resolve(process.env.AXES_REFERENCE_PATH)
      : resolve(thesisSrcDir, 'docs', 'AXES_REFERENCE_V2.md'),

    submoduleSha: str('SUBMODULE_SHA', '9f0c964ea939881b913759e94d180fab175e03f6'),
    submoduleRepoUrl: str('SUBMODULE_REPO_URL', 'https://github.com/NielsterLinden/Thesis'),

    wandbApiKey: str('WANDB_API_KEY'),
    wandbEntity: str('WANDB_ENTITY'),
    wandbSourceProject: str('WANDB_SOURCE_PROJECT'),
    wandbTargetProject: str('WANDB_TARGET_PROJECT', 'thesis-visitor-reports'),
    pythonBin: str('PYTHON_BIN', 'python3'),
    reportsEnabled: false, // derived below
  };
  cached.reportsEnabled =
    !isPlaceholder(cached.wandbEntity) && !isPlaceholder(cached.wandbSourceProject);

  return cached;
}

/** Test helper: forget the memoised config so a test can re-load with new env. */
export function resetConfigForTests(): void {
  cached = null;
}
