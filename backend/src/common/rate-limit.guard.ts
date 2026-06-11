import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppConfig } from '../config';
import { logRequest } from '../telemetry';
import { APP_CONFIG } from '../tokens';

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * In-memory, per-IP fixed-window rate limit — the leaked-password backstop
 * between billing checks (Initial_plan.md §14). It runs BEFORE the password
 * guard so brute-force attempts are throttled too. The counter is in-process,
 * which is correct only under the stated single-instance constraint
 * (max_instances = 1); a second replica would not share it.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly buckets = new Map<string, Bucket>();

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { requestId?: string }>();
    const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown').toString();
    const now = Date.now();

    const bucket = this.buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      this.buckets.set(ip, { count: 1, resetAt: now + this.config.rateLimitWindowMs });
      this.maybePrune(now);
      return true;
    }

    bucket.count += 1;
    if (bucket.count > this.config.rateLimitMaxRequests) {
      logRequest({
        request_id: req.requestId ?? 'unknown',
        ts: new Date().toISOString(),
        route: req.path,
        auth_ok: false,
        status: 429,
        note: 'rate_limited',
      });
      throw new HttpException('Too many requests; slow down.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  /** Drop expired buckets occasionally so the map cannot grow unbounded. */
  private maybePrune(now: number): void {
    if (this.buckets.size < 1024) return;
    for (const [ip, b] of this.buckets) {
      if (now > b.resetAt) this.buckets.delete(ip);
    }
  }
}
