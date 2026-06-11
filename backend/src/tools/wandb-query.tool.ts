import { CsvStore, Row } from './csv-store';
import { Tool, ToolDefinition, ToolResult, toolError } from './types';

const OPS = ['==', '!=', 'in', '>', '<', '>=', '<='] as const;
type Op = (typeof OPS)[number];

const AGGS = ['median', 'mean', 'min', 'max', 'count'] as const;
type Agg = (typeof AGGS)[number];

const MAX_GROUPS = 200;

interface Filter {
  field: string; // caller token (axis ID or column), echoed in the citation
  column: string; // resolved CSV column
  op: Op;
  value: unknown;
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function aggregate(agg: Agg, nums: number[]): number {
  switch (agg) {
    case 'median':
      return median(nums);
    case 'mean':
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    case 'min':
      return Math.min(...nums);
    case 'max':
      return Math.max(...nums);
    case 'count':
      return nums.length;
  }
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  if (Number.isInteger(n)) return String(n);
  // 6 significant figures is plenty for AUROC/loss/latency and avoids noise.
  return String(Number.parseFloat(n.toPrecision(6)));
}

function compare(cellRaw: string | undefined, op: Op, value: unknown): boolean {
  const cell = (cellRaw ?? '').trim();
  switch (op) {
    case '==':
      return cell === String(value);
    case '!=':
      return cell !== String(value);
    case 'in':
      return Array.isArray(value) && value.map(String).includes(cell);
    case '>':
    case '<':
    case '>=':
    case '<=': {
      const a = CsvStore.numeric(cell);
      const b = typeof value === 'number' ? value : Number(value);
      if (a === null || !Number.isFinite(b)) return false;
      if (op === '>') return a > b;
      if (op === '<') return a < b;
      if (op === '>=') return a >= b;
      return a <= b;
    }
  }
}

export class WandbQueryTool implements Tool {
  constructor(private readonly store: CsvStore) {}

  readonly definition: ToolDefinition = {
    name: 'wandb_query',
    description:
      'Query the FROZEN W&B export (data/04_thesis_final.csv) with a structured ' +
      'filter+aggregation. Use this for any quantitative result question ' +
      '(e.g. "median test AUROC for the d256_L6 baseline grouped by B1"). ' +
      'Fields and groupby accept thesis axis IDs (B1, H10, A3, R5, …) or exact ' +
      'CSV columns; the metric accepts a bare name (test_auroc) or a full ' +
      'eval_v2/* column. Aggregation defaults to MEDIAN across seeds (the thesis ' +
      'convention — the mean is misleading with structural outliers). Returns the ' +
      'resolved filter set and the N behind each value, plus a [wandb: …] citation ' +
      'you must include. Filters are structured triples only — there is no raw ' +
      'expression input.',
    input_schema: {
      type: 'object',
      properties: {
        metric: {
          type: 'string',
          description:
            'Summary metric to aggregate, e.g. "test_auroc" (resolved to ' +
            'eval_v2/test_auroc) or a full eval_v2/* column. Ignored when agg="count".',
        },
        filters: {
          type: 'array',
          description: 'Filter triples, AND-ed together.',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                description: 'Axis ID (e.g. "H10") or exact CSV column.',
              },
              op: {
                type: 'string',
                enum: [...OPS],
                description: 'Comparison operator (closed set).',
              },
              value: {
                description:
                  'Scalar for ==,!=,>,<,>=,<=; array of scalars for "in". ' +
                  'Use the literal "<not_applicable>" to match conditional-axis sentinels.',
              },
            },
            required: ['field', 'op', 'value'],
          },
        },
        groupby: {
          description:
            'Axis ID / column, or array of them, to group rows by before ' +
            'aggregating (e.g. "B1"). Omit to aggregate over all matching rows.',
        },
        agg: {
          type: 'string',
          enum: [...AGGS],
          description: 'Aggregation (default "median"). "count" reports group sizes.',
        },
      },
      required: ['metric'],
    },
  };

  execute(input: Record<string, unknown>): ToolResult {
    const agg: Agg = AGGS.includes(input.agg as Agg) ? (input.agg as Agg) : 'median';

    // Resolve metric (not needed for count, but we still resolve if provided).
    let metricColumn = '';
    if (agg !== 'count') {
      const metricToken = input.metric;
      if (typeof metricToken !== 'string' || metricToken.length === 0) {
        return toolError('"metric" is required (a bare name like "test_auroc" or an eval_v2/* column).');
      }
      const resolved = this.store.resolveMetric(metricToken);
      if (!resolved) {
        return toolError(
          `unknown metric "${metricToken}". Expected a bare name resolving to ` +
            `eval_v2/<name> or an exact column. Example metrics: test_auroc, test_acc, ` +
            `num_parameters_total.`,
        );
      }
      metricColumn = resolved;
    }

    // Resolve and validate filters.
    const filters: Filter[] = [];
    const rawFilters = input.filters;
    if (rawFilters !== undefined) {
      if (!Array.isArray(rawFilters)) return toolError('"filters" must be an array of {field, op, value}.');
      for (const f of rawFilters) {
        if (typeof f !== 'object' || f === null) return toolError('each filter must be an object {field, op, value}.');
        const field = (f as Record<string, unknown>).field;
        const op = (f as Record<string, unknown>).op;
        const value = (f as Record<string, unknown>).value;
        if (typeof field !== 'string') return toolError('filter.field must be a string.');
        if (typeof op !== 'string' || !OPS.includes(op as Op)) {
          return toolError(`filter.op must be one of ${OPS.join(', ')}.`);
        }
        if (op === 'in' && !Array.isArray(value)) return toolError('op "in" requires an array value.');
        const column = this.store.resolveAxisColumn(field);
        if (!column) {
          return toolError(`unknown filter field "${field}" (no matching axis ID or column).`);
        }
        filters.push({ field, column, op: op as Op, value });
      }
    }

    // Resolve groupby.
    const groupbyTokens: string[] = [];
    if (input.groupby !== undefined) {
      const raw = Array.isArray(input.groupby) ? input.groupby : [input.groupby];
      for (const g of raw) {
        if (typeof g !== 'string') return toolError('groupby entries must be strings.');
        const column = this.store.resolveAxisColumn(g);
        if (!column) return toolError(`unknown groupby field "${g}" (no matching axis ID or column).`);
        groupbyTokens.push(g);
      }
    }
    const groupbyColumns = groupbyTokens.map((g) => this.store.resolveAxisColumn(g) as string);

    // Apply filters.
    const filtered = this.store.rows.filter((row) =>
      filters.every((flt) => compare(row[flt.column], flt.op, flt.value)),
    );

    const filterDesc = this.describeFilters(filters);
    if (filtered.length === 0) {
      return {
        content:
          `No runs match ${filterDesc || '(no filters)'}.\n` +
          `[wandb: ${this.citationFilters(filters)}, N=0]`,
      };
    }

    const lines: string[] = [];
    if (groupbyColumns.length === 0) {
      const result = this.aggregateGroup(filtered, agg, metricColumn);
      lines.push(this.formatGroupLine(null, result, agg, metricColumn));
    } else {
      const groups = this.groupRows(filtered, groupbyColumns);
      const keys = [...groups.keys()].sort();
      const shown = keys.slice(0, MAX_GROUPS);
      for (const key of shown) {
        const result = this.aggregateGroup(groups.get(key) as Row[], agg, metricColumn);
        lines.push(this.formatGroupLine(key, result, agg, metricColumn));
      }
      if (keys.length > shown.length) {
        lines.push(`… (${keys.length - shown.length} more groups omitted; add filters to narrow)`);
      }
    }

    const header =
      `${agg === 'count' ? 'Run counts' : `${agg} of ${metricColumn}`}` +
      (groupbyTokens.length ? ` grouped by ${groupbyTokens.join(', ')}` : '') +
      (filterDesc ? ` where ${filterDesc}` : '') +
      ` (${filtered.length} matching runs):`;

    const citation = `[wandb: ${this.citationFilters(filters)}${
      groupbyTokens.length ? `, groupby=${groupbyTokens.join('+')}` : ''
    }, metric=${agg === 'count' ? 'count' : metricColumn}, agg=${agg}]`;

    return { content: `${header}\n${lines.join('\n')}\n${citation}` };
  }

  private aggregateGroup(
    rows: Row[],
    agg: Agg,
    metricColumn: string,
  ): { value: number; n: number; skipped: number } {
    if (agg === 'count') {
      return { value: rows.length, n: rows.length, skipped: 0 };
    }
    const nums: number[] = [];
    let skipped = 0;
    for (const row of rows) {
      const v = CsvStore.numeric(row[metricColumn]);
      if (v === null) skipped++;
      else nums.push(v);
    }
    return { value: aggregate(agg, nums), n: nums.length, skipped };
  }

  private groupRows(rows: Row[], groupbyColumns: string[]): Map<string, Row[]> {
    const groups = new Map<string, Row[]>();
    for (const row of rows) {
      const key = groupbyColumns.map((c) => (row[c] ?? '').trim() || '(blank)').join(' | ');
      const bucket = groups.get(key);
      if (bucket) bucket.push(row);
      else groups.set(key, [row]);
    }
    return groups;
  }

  private formatGroupLine(
    key: string | null,
    result: { value: number; n: number; skipped: number },
    agg: Agg,
    _metricColumn: string,
  ): string {
    const label = key === null ? 'all runs' : key;
    const skippedNote = result.skipped > 0 ? `, ${result.skipped} non-numeric skipped` : '';
    if (agg === 'count') {
      return `  ${label}: N=${result.n}`;
    }
    return `  ${label}: ${fmt(result.value)} (N=${result.n} seeds${skippedNote})`;
  }

  private describeFilters(filters: Filter[]): string {
    return filters
      .map((f) => {
        const val = Array.isArray(f.value) ? `[${f.value.map(String).join(', ')}]` : String(f.value);
        return `${f.field}${f.op}${val}`;
      })
      .join(' AND ');
  }

  private citationFilters(filters: Filter[]): string {
    if (filters.length === 0) return 'no filters';
    return filters
      .map((f) => {
        const val = Array.isArray(f.value) ? `[${f.value.map(String).join(',')}]` : `"${String(f.value)}"`;
        return `${f.field}${f.op}${val}`;
      })
      .join(', ');
  }
}
