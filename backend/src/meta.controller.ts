import { Controller, Get, Inject } from '@nestjs/common';
import { AppConfig } from './config';
import { APP_CONFIG } from './tokens';

/**
 * GET /meta — ungated, static facts the frontend needs to render citations:
 * the submodule repo URL and pinned SHA, from which [code: path:lines] tokens
 * become links to the exact frozen blob. Nothing here is secret (the URL is
 * committed in .gitmodules), and serving it from the backend means a thesis
 * refresh (Initial_plan.md §3.1) updates citation links without a frontend
 * rebuild.
 */
@Controller()
export class MetaController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('meta')
  meta(): { thesis_repo_url: string; thesis_src_commit: string } {
    return {
      thesis_repo_url: this.config.submoduleRepoUrl,
      thesis_src_commit: this.config.submoduleSha,
    };
  }
}
