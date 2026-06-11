import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SitePasswordGuard } from '../auth/site-password.guard';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { AppConfig } from '../config';
import { logRequest } from '../telemetry';
import { APP_CONFIG } from '../tokens';
import { loadCsvStore } from '../tools/csv-store';
import { SidecarService } from './sidecar.service';
import { validateReportSpec } from './spec';

type ReqWithMeta = Request & { requestId?: string; startTime?: number };

export interface SaveReportResponseDto {
  url: string;
}

/**
 * Call 2 of the two-call write protocol (Initial_plan.md §6.3): the human
 * clicked confirm, the browser POSTs the spec back, and the server
 * RE-VALIDATES it from scratch before invoking the sidecar. The model cannot
 * reach this endpoint; routing (entity/source/target project) is overwritten
 * from server config no matter what the body says. Reports are saved as
 * drafts, only ever into the quarantine project.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sidecar: SidecarService,
  ) {}

  @Post('save')
  @HttpCode(200)
  @UseGuards(RateLimitGuard, SitePasswordGuard)
  async save(@Body() body: unknown, @Req() req: ReqWithMeta): Promise<SaveReportResponseDto> {
    const requestId = req.requestId ?? 'unknown';
    const start = req.startTime ?? Date.now();
    const log = (status: number, note: string) =>
      logRequest({
        request_id: requestId,
        ts: new Date().toISOString(),
        route: req.path,
        auth_ok: true,
        status,
        duration_ms: Date.now() - start,
        note,
      });

    if (!this.config.reportsEnabled) {
      log(503, 'reports_disabled');
      throw new ServiceUnavailableException('Report authoring is not enabled on this deployment.');
    }
    const key = this.config.wandbApiKey;
    if (!key || key.startsWith('REPLACE')) {
      log(503, 'wandb_key_missing');
      throw new ServiceUnavailableException('The server has no W&B credentials configured.');
    }
    if (!this.sidecar.available()) {
      log(503, 'sidecar_missing');
      throw new ServiceUnavailableException('The report renderer is not installed on this deployment.');
    }

    const specRaw =
      typeof body === 'object' && body !== null ? (body as { spec?: unknown }).spec : undefined;
    if (specRaw === undefined) {
      log(400, 'bad_request');
      throw new BadRequestException('Request body must be {"spec": …} from a confirm card.');
    }

    const result = validateReportSpec(specRaw, {
      entity: this.config.wandbEntity,
      sourceProject: this.config.wandbSourceProject,
      targetProject: this.config.wandbTargetProject,
      csv: loadCsvStore(this.config.dataCsvPath),
    });
    if (!result.ok) {
      log(400, 'spec_rejected');
      throw new BadRequestException(`Report spec rejected: ${result.errors.join(' ')}`);
    }

    const outcome = await this.sidecar.render(result.spec);
    if (!outcome.ok) {
      log(502, 'render_failed');
      throw new BadGatewayException(`Saving the draft report failed: ${outcome.error}`);
    }

    log(200, 'report_draft_saved');
    return { url: outcome.url };
  }
}
