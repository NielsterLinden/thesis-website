import { AppConfig } from '../config';
import { AuthorReportTool } from './author-report.tool';
import { AxesLookupTool } from './axes-lookup.tool';
import { loadAxesReference } from './axes-reference';
import { loadCsvStore } from './csv-store';
import { RepoGrepTool, RepoReadTool } from './repo.tools';
import { Tool, ToolDefinition, ToolResult } from './types';
import { WandbQueryTool } from './wandb-query.tool';

/**
 * The four MVP tool surfaces (Initial_plan.md §5.3). thesis_context is not a
 * tool — the full TeX lives in the cached prompt prefix (see static-context.ts).
 * author_report (Phase 2) registers only when the W&B entity/source project
 * are configured, so the MVP deploy is unchanged without them.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const t of tools) this.tools.set(t.definition.name, t);
  }

  static build(config: AppConfig): ToolRegistry {
    const csv = loadCsvStore(config.dataCsvPath);
    const axes = loadAxesReference(config.axesReferencePath);
    const tools: Tool[] = [
      new RepoGrepTool(config.thesisSrcDir),
      new RepoReadTool(config.thesisSrcDir),
      new WandbQueryTool(csv),
      new AxesLookupTool(axes, csv),
    ];
    if (config.reportsEnabled) {
      tools.push(
        new AuthorReportTool(csv, {
          entity: config.wandbEntity,
          sourceProject: config.wandbSourceProject,
          targetProject: config.wandbTargetProject,
        }),
      );
    }
    return new ToolRegistry(tools);
  }

  definitions(): ToolDefinition[] {
    return [...this.tools.values()].map((t) => t.definition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  async dispatch(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { content: `ERROR: unknown tool "${name}".`, isError: true };
    }
    try {
      return await tool.execute(input ?? {});
    } catch (e) {
      // Containment: a tool throwing must not crash the agent loop — return an
      // error result so the model can recover or refuse.
      return { content: `ERROR: tool "${name}" failed: ${String(e)}`, isError: true };
    }
  }
}
