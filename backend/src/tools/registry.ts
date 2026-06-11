import { AppConfig } from '../config';
import { AxesLookupTool } from './axes-lookup.tool';
import { loadAxesReference } from './axes-reference';
import { loadCsvStore } from './csv-store';
import { RepoGrepTool, RepoReadTool } from './repo.tools';
import { Tool, ToolDefinition, ToolResult } from './types';
import { WandbQueryTool } from './wandb-query.tool';

/**
 * The four MVP tool surfaces (Initial_plan.md §5.3). thesis_context is not a
 * tool — the full TeX lives in the cached prompt prefix (see static-context.ts).
 * author_report is Phase 2.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  constructor(tools: Tool[]) {
    for (const t of tools) this.tools.set(t.definition.name, t);
  }

  static build(config: AppConfig): ToolRegistry {
    const csv = loadCsvStore(config.dataCsvPath);
    const axes = loadAxesReference(config.axesReferencePath);
    return new ToolRegistry([
      new RepoGrepTool(config.thesisSrcDir),
      new RepoReadTool(config.thesisSrcDir),
      new WandbQueryTool(csv),
      new AxesLookupTool(axes, csv),
    ]);
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
