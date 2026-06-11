import { Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { RateLimitGuard } from '../common/rate-limit.guard';
import { logRequest } from '../telemetry';
import { SitePasswordGuard } from './site-password.guard';

type ReqWithMeta = Request & { requestId?: string; startTime?: number };

/**
 * POST /auth/check — a gated no-op so the frontend can verify the password at
 * the gate without triggering a paid Anthropic call. Same guard order as
 * /chat: rate limit first (throttles brute force), then the password.
 */
@Controller('auth')
export class AuthController {
  @Post('check')
  @HttpCode(200)
  @UseGuards(RateLimitGuard, SitePasswordGuard)
  check(@Req() req: ReqWithMeta): { ok: true } {
    logRequest({
      request_id: req.requestId ?? 'unknown',
      ts: new Date().toISOString(),
      route: req.path,
      auth_ok: true,
      status: 200,
      duration_ms: Date.now() - (req.startTime ?? Date.now()),
    });
    return { ok: true };
  }
}
