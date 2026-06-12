import { Controller, Get, Header, Inject } from '@nestjs/common';
import { AppConfig, isPlaceholder } from './config';
import { loadThesisAnchors, ThesisAnchors } from './thesis-anchors';
import { APP_CONFIG } from './tokens';

/**
 * GET /meta — ungated, static facts the frontend needs to render citations and
 * the landing-page links: the submodule repo URL and pinned SHA, from which
 * [code: path:lines] tokens become links to the exact frozen blob, plus the
 * W&B browse URLs (runs table, reports list). Nothing here is secret (the URL
 * is committed in .gitmodules; the W&B project is examiner-visible), and
 * serving it from the backend means a thesis refresh (Initial_plan.md §3.1) or
 * a W&B project move updates the links without a frontend rebuild.
 */
@Controller()
export class MetaController {
  private readonly anchors: ThesisAnchors;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.anchors = loadThesisAnchors(config);
  }

  /** Citation key -> hyperref named destination in /thesis.pdf, so the
   *  frontend can turn [thesis: §4.2 / Eq. (6.1) / fig:…] chips into
   *  #nameddest deep links. Ungated for the same reason /thesis.pdf is. */
  @Get('thesis-anchors.json')
  @Header('Cache-Control', 'public, max-age=300')
  thesisAnchors(): ThesisAnchors {
    return this.anchors;
  }

  @Get('meta')
  meta(): {
    thesis_repo_url: string;
    thesis_src_commit: string;
    wandb_runs_url: string | null;
    wandb_reports_url: string | null;
  } {
    // Browse links need only the entity + source project; deliberately not
    // chained to reportsEnabled, which means "authoring on" (needs a key too).
    const wandbConfigured =
      !isPlaceholder(this.config.wandbEntity) && !isPlaceholder(this.config.wandbSourceProject);
    const wandbBase = wandbConfigured
      ? `https://wandb.ai/${encodeURIComponent(this.config.wandbEntity)}/${encodeURIComponent(this.config.wandbSourceProject)}`
      : null;
    return {
      thesis_repo_url: this.config.submoduleRepoUrl,
      thesis_src_commit: this.config.submoduleSha,
      wandb_runs_url: wandbBase && `${wandbBase}/table`,
      wandb_reports_url: wandbBase && `${wandbBase}/reportlist`,
    };
  }
}
