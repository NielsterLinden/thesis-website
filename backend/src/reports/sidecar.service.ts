import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig } from '../config';
import { APP_CONFIG } from '../tokens';
import { ReportSpec } from './spec';

/** Generous: a cold wandb import + report save does real network round-trips. */
const SIDECAR_TIMEOUT_MS = 180_000;
const MAX_CAPTURE_BYTES = 1_000_000;
const MAX_ERROR_CHARS = 500;

export type SidecarOutcome = { ok: true; url: string } | { ok: false; error: string };

/**
 * The ONLY W&B write path in the system (Initial_plan.md §6): a validated spec
 * goes to sidecar/render_report.py on stdin; the sidecar builds the
 * wandb-workspaces objects, saves a DRAFT report to the target project, and
 * prints one JSON line on stdout. No second port, no long-lived process; the
 * model is never in this code path.
 */
@Injectable()
export class SidecarService {
  private readonly logger = new Logger(SidecarService.name);
  private readonly script: string;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.script = resolve(config.appRoot, 'sidecar', 'render_report.py');
  }

  available(): boolean {
    return existsSync(this.script);
  }

  render(spec: ReportSpec): Promise<SidecarOutcome> {
    return new Promise((resolvePromise) => {
      const child = spawn(this.config.pythonBin, [this.script], {
        cwd: this.config.appRoot,
        env: {
          ...process.env,
          WANDB_API_KEY: this.config.wandbApiKey,
          // Belt and braces: the renderer also refuses any target other than
          // the configured quarantine project.
          WANDB_TARGET_PROJECT: this.config.wandbTargetProject,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;
      const settle = (outcome: SidecarOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolvePromise(outcome);
      };

      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        settle({ ok: false, error: `report renderer timed out after ${SIDECAR_TIMEOUT_MS / 1000}s.` });
      }, SIDECAR_TIMEOUT_MS);

      child.stdout.on('data', (d: Buffer) => {
        if (stdout.length < MAX_CAPTURE_BYTES) stdout += d.toString('utf8');
      });
      child.stderr.on('data', (d: Buffer) => {
        if (stderr.length < MAX_CAPTURE_BYTES) stderr += d.toString('utf8');
      });

      child.on('error', (err) => {
        // Typically: python binary not found (PYTHON_BIN misconfigured).
        settle({ ok: false, error: `could not start the report renderer: ${err.message}` });
      });

      child.on('close', (code) => {
        // The renderer's contract: exactly one JSON object on the LAST
        // non-empty stdout line ({"ok":true,"url":…} | {"ok":false,"error":…}).
        const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
        const last = lines[lines.length - 1] ?? '';
        try {
          const parsed = JSON.parse(last) as { ok?: boolean; url?: string; error?: string };
          if (parsed.ok === true && typeof parsed.url === 'string') {
            settle({ ok: true, url: parsed.url });
            return;
          }
          settle({
            ok: false,
            error: String(parsed.error ?? 'renderer reported failure').slice(0, MAX_ERROR_CHARS),
          });
        } catch {
          this.logger.warn(`sidecar exited ${code} without parseable output`);
          settle({
            ok: false,
            error:
              `report renderer exited with code ${code}: ` +
              `${(stderr || stdout).slice(-MAX_ERROR_CHARS) || '(no output)'}`,
          });
        }
      });

      child.stdin.write(JSON.stringify(spec));
      child.stdin.end();
    });
  }
}
