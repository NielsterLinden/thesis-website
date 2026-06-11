import { AxesReference } from './axes-reference';
import { CsvStore } from './csv-store';
import { Tool, ToolDefinition, ToolResult, toolError } from './types';

/** CSV column `config/axes/A3_Attention Type` -> report-spec `config:axes/A3_Attention Type.value`. */
function toReportSpecKey(csvColumn: string): string {
  return `${csvColumn.replace(/^config\/axes\//, 'config:axes/')}.value`;
}

export class AxesLookupTool implements Tool {
  constructor(
    private readonly axes: AxesReference,
    private readonly store: CsvStore,
  ) {}

  readonly definition: ToolDefinition = {
    name: 'axes_lookup',
    description:
      'Resolve a thesis V2 axis alias (e.g. "A3", "B1", "T1-a", "H10") to its ' +
      'formal Hydra config key, its W&B reference, the exact CSV column used by ' +
      'wandb_query, the report-spec key, and the reference Note (which usually ' +
      'names the file/function that implements the axis — follow up with ' +
      'repo_grep/repo_read to cite the code). This is the bridge that lets one ' +
      'question resolve across the thesis, the code, and the W&B export. Returns ' +
      'an [axes: …] citation for the mapping itself.',
    input_schema: {
      type: 'object',
      properties: {
        alias: {
          type: 'string',
          description: 'The V2 axis ID, e.g. "A3", "B1", "B1-L1", "T1-a", "H10".',
        },
      },
      required: ['alias'],
    },
  };

  execute(input: Record<string, unknown>): ToolResult {
    const alias = input.alias;
    if (typeof alias !== 'string' || alias.trim().length === 0) {
      return toolError('"alias" is required, e.g. "A3".');
    }

    const entry = this.axes.lookup(alias);
    if (!entry) {
      const near = this.suggest(alias.trim().toUpperCase());
      return toolError(
        `unknown axis alias "${alias}". ${near}. Do not guess a mapping — only ` +
          `resolve aliases that exist in ${this.axes.sourceName}.`,
      );
    }

    const csvColumn = this.store.resolveAxisColumn(entry.id);
    const reportSpecKey = csvColumn ? toReportSpecKey(csvColumn) : null;

    const f = entry.fields;
    const out: string[] = [];
    out.push(`Axis ${entry.id} — ${entry.name}`);
    if (f['Config']) out.push(`  Hydra config key: ${f['Config']}`);
    if (f['axes key']) out.push(`  axes key: ${f['axes key']}`);
    if (f['W&B']) out.push(`  W&B reference: ${f['W&B']}`);
    out.push(`  CSV column (for wandb_query): ${csvColumn ?? '(not present in the frozen export)'}`);
    if (reportSpecKey) out.push(`  Report-spec key: ${reportSpecKey}`);
    if (f['Options']) out.push(`  Options: ${f['Options']}`);
    if (f['Default']) out.push(`  Default: ${f['Default']}`);
    if (f['Prerequisite']) out.push(`  Prerequisite: ${f['Prerequisite']}`);
    if (f['Note']) out.push(`  Note: ${f['Note']}`);

    const configForCitation = f['Config'] ?? csvColumn ?? entry.id;
    const citation = `[axes: ${entry.id} = ${configForCitation} (${this.axes.sourceName})]`;

    return { content: `${out.join('\n')}\n${citation}` };
  }

  private suggest(upper: string): string {
    const family = upper.charAt(0);
    const ids = this.axes.ids();
    const sameFamily = ids.filter((id) => id.startsWith(family)).slice(0, 12);
    if (sameFamily.length > 0) {
      return `Known ${family}-axes: ${sameFamily.join(', ')}`;
    }
    return `Known axes start with letters ${[...new Set(ids.map((id) => id.charAt(0)))].join(', ')}`;
  }
}
