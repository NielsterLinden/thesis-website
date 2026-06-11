import { createHash, timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config';
import { logRequest } from '../telemetry';
import { APP_CONFIG } from '../tokens';

export const SITE_PASSWORD_HEADER = 'x-site-password';

/** Constant-time string equality via fixed-length SHA-256 digests (so a
 *  length difference does not leak through timingSafeEqual's length check). */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Shared-password gate on /chat (Initial_plan.md §5.1, §14). No sessions, no
 * users, no database — the browser sends the password as a header on every
 * request. Fails closed: if SITE_PASSWORD is unset the gate rejects everything.
 */
@Injectable()
export class SitePasswordGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    const provided = (req.header(SITE_PASSWORD_HEADER) ?? '').toString();
    const expected = this.config.sitePassword;
    const ok = expected.length > 0 && safeEqual(provided, expected);

    if (!ok) {
      logRequest({
        request_id: req.requestId ?? 'unknown',
        ts: new Date().toISOString(),
        route: req.path,
        auth_ok: false,
        status: 401,
        note: expected.length === 0 ? 'site_password_unset' : 'bad_password',
      });
      throw new UnauthorizedException('Invalid or missing site password.');
    }
    return true;
  }
}
