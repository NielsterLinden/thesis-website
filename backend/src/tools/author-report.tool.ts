import {
  PANEL_KINDS,
  REPORT_AGGS,
  REPORT_OPS,
  ReportFilter,
  ReportProposal,
  ReportSpec,
  validateReportSpec,
} from '../reports/spec';
import { CsvStore, Row, fromReportSpecKey, toReportSpecKey } from './csv-store';
import { Tool, ToolDefinition, ToolResult, toolError } from './types';
import { compare } from './wandb-query.tool';

const MAX_GROUP_LINES = 12;

export interface AuthorReportContext {
  entity: string;
  sourceProject: string;
  targetProject: string;
}

/**
 * Phase 2, call 1 of the two-call write protocol (Initial_plan.md §6.3): turn
 * the model's intent into a validated semantic report spec plus a
 * plain-language summary, and NOTHING else — no `.save()`, no network. The
 * spec rides back to the browser on a side channel (ToolResult.proposal); a
 * human clicks confirm; /reports/save re-validates and invokes the sidecar.
 */
export class AuthorReportTool implements Tool {
  constructor(
    private readonly store: CsvStore,
    private readonly ctx: AuthorReportContext,
  ) {}

  readonly definition: ToolDefinition = {
    name: 'author_report',
    description:
      'Draft a W&B report PROPOSAL from the frozen experiment data. This does ' +
      'NOT create anything: it validates your spec, computes the matching run ' +
      'counts, and shows the user a confirm card — the report is saved (as a ' +
      'draft, to the visitor-reports project) only after the user clicks ' +
      'confirm in the UI. Use it when the user asks to create/save a W&B ' +
      'report of some result. Fields accept thesis axis IDs (B1, H10, …) or ' +
      'exact CSV columns, like wandb_query. After calling, recap the proposal ' +
      'in one or two sentences and point the user to the confirm card; never ' +
      'state that a report was created.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Report title.' },
        description: { type: 'string', description: 'One-line report description.' },
        intro: {
          type: 'string',
          description: 'Optional opening prose paragraph (e.g. what the panels show and why median).',
        },
        filters: {
          type: 'array',
          description:
            'Runset filter triples, AND-ed; same semantics as wandb_query. ' +
            'Structured triples only — raw filter expressions are rejected.',
          items: {
            type: 'object',
            properties: {
              field: { type: 'string', description: 'Axis ID (e.g. "H10") or exact CSV column.' },
              op: { type: 'string', enum: [...REPORT_OPS] },
              value: { description: 'Scalar, or array of scalars for op "in".' },
            },
            required: ['field', 'op', 'value'],
          },
        },
        groupby: {
          description: 'Axis ID (or array of ≤2) to group the runset by, e.g. "B1".',
        },
        panels: {
          type: 'array',
          description:
            'The panels to include, in order. Kinds: ' +
            'scalar_by_axis (one aggregated number per group), ' +
            'bar_by_axis (metric across one axis’ values; needs groupby), ' +
            'scatter (x vs metric, both summary columns), ' +
            'parallel_coords (columns: 2+ axes/metrics, target metric last), ' +
            'axis_importance (parameter importance w.r.t. metric), ' +
            'line (training curves; metric is a history key like "val/auroc" — ' +
            'history keys are not in the frozen CSV and cannot be pre-validated).',
          items: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: [...PANEL_KINDS] },
              title: { type: 'string' },
              metric: {
                type: 'string',
                description: 'Summary metric (e.g. "test_auroc"); for line, a history key.',
              },
              x: { type: 'string', description: 'x metric for scatter/line.' },
              groupby: { type: 'string', description: 'Axis ID to group this panel by.' },
              agg: {
                type: 'string',
                enum: [...REPORT_AGGS],
                description: 'Aggregation across seeds (default median — thesis convention).',
              },
              columns: {
                type: 'array',
                items: { type: 'string' },
                description: 'parallel_coords only: ordered axes/metrics.',
              },
            },
            required: ['kind'],
          },
        },
      },
      required: ['title', 'panels'],
    },
  };

  execute(input: Record<string, unknown>): ToolResult {
    // Resolve model-friendly tokens (axis IDs, bare metric names) into the
    // unambiguous spec forms before validation, echoing wandb_query semantics.
    const resolveField = (token: unknown, what: string): string | { error: string } => {
      if (typeof token !== 'string' || token.trim().length === 0) {
        return { error: `${what} must be a non-empty string.` };
      }
      if (fromReportSpecKey(token) !== null) return token; // already spec-form
      const column = this.store.resolveAxisColumn(token);
      if (column) {
        return column.startsWith('config/') ? toReportSpecKey(column) : column;
      }
      const metric = this.store.resolveMetric(token);
      if (metric) return metric;
      return {
        error: `unknown ${what} "${token}" — no matching axis ID or column in the frozen export. Use axes_lookup to find the right ID.`,
      };
    };

    const rawSpec: Record<string, unknown> = {
      title: input.title,
      description: input.description,
      runset: {} as Record<string, unknown>,
      blocks: [] as unknown[],
    };
    const runset = rawSpec.runset as Record<string, unknown>;
    const blocks = rawSpec.blocks as unknown[];

    if (input.filters !== undefined) {
      if (typeof input.filters === 'string') {
        return toolError('filters must be structured {field, op, value} triples, not an expression string.');
      }
      if (!Array.isArray(input.filters)) return toolError('"filters" must be an array.');
      const filters: unknown[] = [];
      for (const f of input.filters) {
        if (typeof f !== 'object' || f === null) return toolError('each filter must be {field, op, value}.');
        const fr = f as Record<string, unknown>;
        const field = resolveField(fr.field, 'filter field');
        if (typeof field !== 'string') return toolError(field.error);
        filters.push({ field, op: fr.op, value: fr.value });
      }
      runset.filters = filters;
    }

    if (input.groupby !== undefined) {
      const rawGroup = Array.isArray(input.groupby) ? input.groupby : [input.groupby];
      const groupby: string[] = [];
      for (const g of rawGroup) {
        const resolved = resolveField(g, 'groupby');
        if (typeof resolved !== 'string') return toolError(resolved.error);
        groupby.push(resolved);
      }
      runset.groupby = groupby;
    }

    if (typeof input.intro === 'string' && input.intro.trim().length > 0) {
      blocks.push({ type: 'prose', text: input.intro });
    }

    if (!Array.isArray(input.panels)) return toolError('"panels" is required (array).');
    for (const p of input.panels) {
      if (typeof p !== 'object' || p === null) return toolError('each panel must be an object.');
      const pr = p as Record<string, unknown>;
      const panel: Record<string, unknown> = { type: 'panel', kind: pr.kind, agg: pr.agg };
      if (typeof pr.title === 'string' && pr.title.trim().length > 0) {
        blocks.push({ type: 'heading', text: pr.title });
        panel.title = pr.title;
      }
      for (const key of ['metric', 'x', 'y'] as const) {
        if (pr[key] !== undefined) {
          // line panels may reference history keys that are absent from the
          // summary CSV — pass those through for the validator's lenient path.
          if (pr.kind === 'line') {
            panel[key] = pr[key];
          } else {
            const resolved = resolveField(pr[key], `panel ${key}`);
            if (typeof resolved !== 'string') return toolError(resolved.error);
            panel[key] = resolved;
          }
        }
      }
      if (pr.groupby !== undefined) {
        const resolved = resolveField(pr.groupby, 'panel groupby');
        if (typeof resolved !== 'string') return toolError(resolved.error);
        panel.groupby = resolved;
      }
      if (pr.columns !== undefined) {
        if (!Array.isArray(pr.columns)) return toolError('panel.columns must be an array.');
        const columns: string[] = [];
        for (const c of pr.columns) {
          const resolved = resolveField(c, 'panel column');
          if (typeof resolved !== 'string') return toolError(resolved.error);
          columns.push(resolved);
        }
        panel.columns = columns;
      }
      blocks.push(panel);
    }

    const result = validateReportSpec(rawSpec, {
      entity: this.ctx.entity,
      sourceProject: this.ctx.sourceProject,
      targetProject: this.ctx.targetProject,
      csv: this.store,
    });

    if (!result.ok) {
      return toolError(`report spec rejected:\n- ${result.errors.join('\n- ')}`);
    }

    const summary = this.summarize(result.spec);
    const proposal: ReportProposal = { spec: result.spec, summary };

    return {
      content:
        `Report proposal VALIDATED (nothing saved yet).\n${summary}\n` +
        `The user now sees a confirm card in the chat; the draft is created only ` +
        `if they click Confirm. Recap the proposal briefly and tell the user to ` +
        `use the confirm card — do not claim the report exists.`,
      proposal,
    };
  }

  /** Plain-language §6.3 summary: what gets written where, over which runs. */
  private summarize(spec: ReportSpec): string {
    const lines: string[] = [];
    lines.push(`Title: ${spec.title}`);
    if (spec.description) lines.push(`Description: ${spec.description}`);
    lines.push(
      `Writes to: ${spec.entity}/${spec.target_project} as a DRAFT (never auto-published).`,
    );
    lines.push(`Reads runs from: ${spec.entity}/${spec.source_project}.`);

    const { filters, groupby } = spec.runset;
    const matching = this.matchingRows(filters);
    const filterDesc =
      filters.length === 0
        ? 'no filters (all runs)'
        : filters
            .map((f) => {
              const v = Array.isArray(f.value) ? `[${f.value.join(', ')}]` : String(f.value);
              return `${this.shortField(f.field)}${f.op}${v}`;
            })
            .join(' AND ');
    lines.push(`Runset: ${filterDesc} — N=${matching.length} runs in the frozen export.`);

    if (groupby.length > 0) {
      const counts = this.groupCounts(matching, groupby);
      const keys = [...counts.keys()].sort();
      const label = groupby.map((g) => this.shortField(g)).join(' | ');
      const shown = keys.slice(0, MAX_GROUP_LINES);
      lines.push(
        `Grouped by ${label} (${keys.length} groups): ` +
          shown.map((k) => `${k} N=${counts.get(k)}`).join(', ') +
          (keys.length > shown.length ? `, … ${keys.length - shown.length} more` : ''),
      );
    }

    lines.push('Panels:');
    let i = 0;
    for (const b of spec.blocks) {
      if (b.type !== 'panel') continue;
      i++;
      const parts: string[] = [b.kind];
      if (b.metric) parts.push(`of ${b.metric}`);
      if (b.x) parts.push(`vs ${b.x}`);
      if (b.groupby) parts.push(`by ${this.shortField(b.groupby)}`);
      if (b.agg) parts.push(`(${b.agg})`);
      if (b.columns) parts.push(`columns: ${b.columns.map((c) => this.shortField(c)).join(' → ')}`);
      lines.push(`  ${i}. ${parts.join(' ')}`);
      if (b.kind === 'line') {
        lines.push('     (line panels use training-history keys, which are not pre-validated against the frozen CSV)');
      }
    }
    return lines.join('\n');
  }

  /** `config:axes/B1_Bias Activation Set.value` -> `B1_Bias Activation Set` for readable summaries. */
  private shortField(field: string): string {
    const column = fromReportSpecKey(field) ?? field;
    return column.replace(/^config\/axes\//, '').replace(/^config\//, '');
  }

  private matchingRows(filters: ReportFilter[]): Row[] {
    const resolved = filters.map((f) => ({
      column: fromReportSpecKey(f.field) ?? f.field,
      op: f.op,
      value: f.value,
    }));
    return this.store.rows.filter((row) =>
      resolved.every((f) => compare(row[f.column], f.op, f.value)),
    );
  }

  private groupCounts(rows: Row[], groupby: string[]) {
    const columns = groupby.map((g) => fromReportSpecKey(g) ?? g);
    const counts = new Map<string, number>();
    for (const row of rows) {
      const key = columns.map((c) => (row[c] ?? '').trim() || '(blank)').join(' | ');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }
}
