import { randomUUID } from 'node:crypto';
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AgentController } from './agent/agent.controller';
import { AgentService } from './agent/agent.service';
import { AuthController } from './auth/auth.controller';
import { SitePasswordGuard } from './auth/site-password.guard';
import { RateLimitGuard } from './common/rate-limit.guard';
import { loadConfig } from './config';
import { HealthController } from './health.controller';
import { MediaController } from './media.controller';
import { MetaController } from './meta.controller';
import { APP_CONFIG } from './tokens';

@Module({
  controllers: [AgentController, AuthController, MediaController, MetaController, HealthController],
  providers: [
    { provide: APP_CONFIG, useFactory: loadConfig },
    AgentService,
    RateLimitGuard,
    SitePasswordGuard,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Assign a request id + start time to every request so guards and the
    // controller emit correlated, content-free telemetry lines.
    consumer
      .apply((req: Request & { requestId?: string; startTime?: number }, _res: Response, next: NextFunction) => {
        req.requestId = randomUUID();
        req.startTime = Date.now();
        next();
      })
      .forRoutes('*');
  }
}
