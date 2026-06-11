import { Controller, Get } from '@nestjs/common';
import { AgentService } from './agent/agent.service';

/**
 * Liveness/readiness probe (ungated). Returns only metadata — token counts and
 * tool count — never any conversation or thesis content. Useful as a Render
 * health check and to confirm the static context loaded at startup.
 */
@Controller()
export class HealthController {
  constructor(private readonly agent: AgentService) {}

  @Get('health')
  health(): { status: string; context: { approxTokens: number; thesisFiles: number; tools: number } } {
    return { status: 'ok', context: this.agent.contextStats() };
  }
}
