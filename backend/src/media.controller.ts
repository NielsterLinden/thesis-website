import { existsSync } from 'node:fs';
import { Controller, Get, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfig } from './config';
import { APP_CONFIG } from './tokens';

/**
 * Serves the compiled thesis PDF (Initial_plan.md §5.4). Ungated: the PDF is a
 * public artifact the examiners already hold; the spend-sensitive surface is
 * /chat, which the password guard protects.
 */
@Controller()
export class MediaController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('thesis.pdf')
  getThesisPdf(@Res() res: Response): void {
    const path = this.config.thesisPdfPath;
    if (!existsSync(path)) {
      res.status(404).send('thesis.pdf not found');
      return;
    }
    res.type('application/pdf');
    res.sendFile(path, (err) => {
      if (err && !res.headersSent) res.status(500).end();
    });
  }
}
