import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { Controller, Get, Inject, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AppConfig } from './config';
import { APP_CONFIG } from './tokens';

/**
 * Serves the frozen W&B export for download. Ungated for the same reason as
 * /thesis.pdf: the data is a public artifact of the thesis (the same rows back
 * every [wandb: …] citation); the spend-sensitive surface is /chat.
 */
@Controller()
export class DataController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** Lazily gzipped CSV (~33 MB -> ~9 MB), cached for the process lifetime —
   *  the export is frozen, so the bytes never change under us. */
  private gz: Buffer | null = null;

  @Get('data/runs.csv')
  getRunsCsv(@Req() req: Request, @Res() res: Response): void {
    const path = this.config.dataCsvPath;
    if (!existsSync(path)) {
      res.status(404).send('runs.csv not found');
      return;
    }
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    // The exact frozen-artifact filename, for provenance.
    res.setHeader('content-disposition', 'attachment; filename="04_thesis_final.csv"');
    res.setHeader('cache-control', 'public, max-age=3600');
    // Browsers always accept gzip; the identity fallback keeps plain clients
    // (curl -O without --compressed) from saving a gzip blob named .csv.
    if (String(req.headers['accept-encoding'] ?? '').includes('gzip')) {
      this.gz ??= gzipSync(readFileSync(path));
      res.setHeader('content-encoding', 'gzip');
      res.setHeader('vary', 'accept-encoding');
      res.send(this.gz);
      return;
    }
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  }
}
