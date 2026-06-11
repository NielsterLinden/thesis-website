import { CsvStore, fromReportSpecKey } from '../tools/csv-store';

/**
 * The semantic report spec (Initial_plan.md §6.2) — the library-agnostic
 * contract between the model, the confirm gate, and the Python sidecar.
 * Claude emits intent through author_report; this module validates it; only
 * sidecar/render_report.py knows that wandb-workspaces exists.
 *
 * Security properties enforced here (§6.3, §14):
 *   - Filters are structured triples with a closed op set. A filter given as
 *     a string (a raw expression) is rejected outright — nothing in a spec is
 *     ever eval'd or parsed as an expression on our side of the boundary.
 *   - entity / source_project / target_project are not caller-controlled:
 *     validate() overwrites them from server config, so a spec can only ever
 *     read the frozen canonical project and write the quarantine project.
 *   - Everything is bounded (counts and string lengths) so a spec cannot be
 *     used as a payload amplifier.
 */

export const REPORT_OPS = ['==', '!=', 'in', '>', '<', '>=', '<='] as const;
export type ReportOp = (typeof REPORT_OPS)[number];

export const REPORT_AGGS = ['median', 'mean', 'min', 'max'] as const;
export type ReportAgg = (typeof REPORT_AGGS)[number];

export const PANEL_KINDS = [
  'scalar_by_axis',
  'bar_by_axis',
  'scatter',
  'parallel_coords',
  'axis_importance',
  'line',
] as const;
export type PanelKind = (typeof PANEL_KINDS)[number];

export type FilterValue = string | number | boolean;

export interface ReportFilter {
  /** Spec-form config key (`config:axes/….value`) or a summary metric column. */
  field: string;
  op: ReportOp;
  value: FilterValue | FilterValue[];
}

export interface HeadingBlock {
  type: 'heading';
  text: string;
}

export interface ProseBlock {
  type: 'prose';
  text: string;
}

export interface PanelBlock {
  type: 'panel';
  kind: PanelKind;
  title?: string;
  /** Summary metric (y / target), e.g. `eval_v2/test_auroc`. */
  metric?: string;
  /** x metric for scatter/line (a summary column, or a history key for line). */
  x?: string;
  /** Spec-form config key to group bars/scalars by. */
  groupby?: string;
  agg?: ReportAgg;
  /** parallel_coords: ordered columns (spec-form config keys and/or metrics). */
  columns?: string[];
}

export type ReportBlock = HeadingBlock | ProseBlock | PanelBlock;

export interface ReportSpec {
  title: string;
  description: string;
  entity: string;
  source_project: string;
  target_project: string;
  runset: {
    filters: ReportFilter[];
    groupby: string[];
  };
  blocks: ReportBlock[];
}

const LIMITS = {
  title: 200,
  description: 2_000,
  prose: 4_000,
  heading: 200,
  fieldToken: 300,
  stringValue: 300,
  filters: 8,
  inValues: 24,
  runsetGroupby: 2,
  blocks: 16,
  panels: 8,
  pcColumns: 10,
};

/** History keys for line panels (epoch curves) are not in the frozen summary
 *  CSV, so they cannot be ground-truthed — but they must still look like keys,
 *  not expressions. */
const KEYISH_RE = /^[\w./:\- ]+$/;

export type ValidationResult = { ok: true; spec: ReportSpec } | { ok: false; errors: string[] };

/** What the confirm gate shows and what /reports/save receives back. */
export interface ReportProposal {
  spec: ReportSpec;
  /** Plain-language summary: panel kinds, metric, filters, group counts, target project (§6.3). */
  summary: string;
}

export interface SpecContext {
  entity: string;
  sourceProject: string;
  targetProject: string;
  /** The frozen export — used to ground-truth config keys and summary metrics. */
  csv: CsvStore;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isScalar(v: unknown): v is FilterValue {
  return (
    typeof v === 'number' ||
    typeof v === 'boolean' ||
    (typeof v === 'string' && v.length <= LIMITS.stringValue)
  );
}

/** A field is valid when it maps back to a real column of the frozen export:
 *  either a spec-form config key or a summary metric column. */
function resolveFieldColumn(field: string, csv: CsvStore): string | null {
  const csvColumn = fromReportSpecKey(field);
  if (csvColumn !== null) return csv.hasColumn(csvColumn) ? csvColumn : null;
  return csv.resolveMetric(field);
}

export function validateReportSpec(raw: unknown, ctx: SpecContext): ValidationResult {
  const errors: string[] = [];
  const err = (m: string): null => {
    errors.push(m);
    return null;
  };

  if (!isPlainObject(raw)) return { ok: false, errors: ['spec must be a JSON object.'] };

  const title =
    typeof raw.title === 'string' && raw.title.trim().length > 0 && raw.title.length <= LIMITS.title
      ? raw.title.trim()
      : err(`title is required (non-empty string, ≤${LIMITS.title} chars).`);

  let description = '';
  if (raw.description !== undefined) {
    if (typeof raw.description === 'string' && raw.description.length <= LIMITS.description) {
      description = raw.description;
    } else {
      err(`description must be a string ≤${LIMITS.description} chars.`);
    }
  }

  // Server-authoritative routing: whatever the caller sent for entity /
  // source_project / target_project is ignored — but a *mismatching* explicit
  // target is rejected loudly rather than silently rerouted.
  if (
    typeof raw.target_project === 'string' &&
    raw.target_project.length > 0 &&
    raw.target_project !== ctx.targetProject
  ) {
    err(`target_project must be "${ctx.targetProject}" (reports are only ever written there).`);
  }

  const filters: ReportFilter[] = [];
  const groupby: string[] = [];
  const runsetRaw = raw.runset;
  if (runsetRaw !== undefined && !isPlainObject(runsetRaw)) {
    err('runset must be an object {filters, groupby}.');
  } else if (isPlainObject(runsetRaw)) {
    if (typeof runsetRaw.filters === 'string' || typeof runsetRaw.query === 'string') {
      err('runset filters must be structured {field, op, value} triples — raw filter-expression strings are not accepted.');
    } else if (runsetRaw.filters !== undefined) {
      if (!Array.isArray(runsetRaw.filters)) {
        err('runset.filters must be an array.');
      } else if (runsetRaw.filters.length > LIMITS.filters) {
        err(`runset.filters cannot exceed ${LIMITS.filters} triples.`);
      } else {
        for (const f of runsetRaw.filters) {
          const parsed = parseFilter(f, ctx.csv, errors);
          if (parsed) filters.push(parsed);
        }
      }
    }
    if (runsetRaw.groupby !== undefined) {
      const rawGroup = Array.isArray(runsetRaw.groupby) ? runsetRaw.groupby : [runsetRaw.groupby];
      if (rawGroup.length > LIMITS.runsetGroupby) {
        err(`runset.groupby cannot exceed ${LIMITS.runsetGroupby} keys.`);
      } else {
        for (const g of rawGroup) {
          if (typeof g !== 'string' || g.length > LIMITS.fieldToken) {
            err('runset.groupby entries must be spec-form config keys.');
          } else if (fromReportSpecKey(g) === null || resolveFieldColumn(g, ctx.csv) === null) {
            err(`runset.groupby key "${g}" does not match a config column of the frozen export.`);
          } else {
            groupby.push(g);
          }
        }
      }
    }
  }

  const blocks: ReportBlock[] = [];
  let panels = 0;
  if (!Array.isArray(raw.blocks) || raw.blocks.length === 0) {
    err('blocks is required (non-empty array).');
  } else if (raw.blocks.length > LIMITS.blocks) {
    err(`blocks cannot exceed ${LIMITS.blocks} entries.`);
  } else {
    for (const b of raw.blocks) {
      const block = parseBlock(b, ctx.csv, errors);
      if (block) {
        if (block.type === 'panel') panels++;
        blocks.push(block);
      }
    }
    if (panels === 0) err('the report needs at least one panel block.');
    if (panels > LIMITS.panels) err(`panel blocks cannot exceed ${LIMITS.panels}.`);
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    spec: {
      title: title as string,
      description,
      entity: ctx.entity,
      source_project: ctx.sourceProject,
      target_project: ctx.targetProject,
      runset: { filters, groupby },
      blocks,
    },
  };
}

function parseFilter(f: unknown, csv: CsvStore, errors: string[]): ReportFilter | null {
  if (typeof f === 'string') {
    errors.push('filters must be {field, op, value} objects — raw expression strings are not accepted.');
    return null;
  }
  if (!isPlainObject(f)) {
    errors.push('each filter must be an object {field, op, value}.');
    return null;
  }
  const { field, op, value } = f;
  if (typeof field !== 'string' || field.length === 0 || field.length > LIMITS.fieldToken) {
    errors.push('filter.field must be a non-empty string.');
    return null;
  }
  if (resolveFieldColumn(field, csv) === null) {
    errors.push(
      `filter field "${field}" does not match the frozen export (expected a ` +
        `config:….value key or a summary metric column).`,
    );
    return null;
  }
  if (typeof op !== 'string' || !REPORT_OPS.includes(op as ReportOp)) {
    errors.push(`filter.op must be one of ${REPORT_OPS.join(', ')}.`);
    return null;
  }
  if (op === 'in') {
    if (!Array.isArray(value) || value.length === 0 || value.length > LIMITS.inValues) {
      errors.push(`op "in" requires a non-empty array value (≤${LIMITS.inValues} entries).`);
      return null;
    }
    if (!value.every(isScalar)) {
      errors.push('op "in" values must be scalars (string/number/boolean).');
      return null;
    }
    return { field, op, value: value as FilterValue[] };
  }
  if (!isScalar(value)) {
    errors.push(`filter.value for op "${op}" must be a scalar (string/number/boolean).`);
    return null;
  }
  return { field, op: op as ReportOp, value };
}

function parseBlock(b: unknown, csv: CsvStore, errors: string[]): ReportBlock | null {
  if (!isPlainObject(b)) {
    errors.push('each block must be an object with a "type".');
    return null;
  }
  const type = b.type;

  if (type === 'heading' || type === 'prose') {
    const max = type === 'heading' ? LIMITS.heading : LIMITS.prose;
    if (typeof b.text !== 'string' || b.text.trim().length === 0 || b.text.length > max) {
      errors.push(`${type} block needs non-empty "text" (≤${max} chars).`);
      return null;
    }
    return { type, text: b.text };
  }

  if (type !== 'panel') {
    errors.push(`unknown block type "${String(type)}" (heading | prose | panel).`);
    return null;
  }

  const kind = b.kind;
  if (typeof kind !== 'string' || !PANEL_KINDS.includes(kind as PanelKind)) {
    errors.push(`panel.kind must be one of ${PANEL_KINDS.join(', ')}.`);
    return null;
  }

  const panel: PanelBlock = { type: 'panel', kind: kind as PanelKind };

  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.length > LIMITS.heading) {
      errors.push('panel.title must be a string.');
      return null;
    }
    panel.title = b.title;
  }

  if (b.agg !== undefined) {
    if (typeof b.agg !== 'string' || !REPORT_AGGS.includes(b.agg as ReportAgg)) {
      errors.push(`panel.agg must be one of ${REPORT_AGGS.join(', ')}.`);
      return null;
    }
    panel.agg = b.agg as ReportAgg;
  }

  const metricOk = (token: unknown, label: string, allowHistory = false): string | null => {
    if (typeof token !== 'string' || token.length === 0 || token.length > LIMITS.fieldToken) {
      errors.push(`panel.${label} must be a non-empty string.`);
      return null;
    }
    const resolved = csv.resolveMetric(token);
    if (resolved) return resolved;
    if (fromReportSpecKey(token) !== null && resolveFieldColumn(token, csv) !== null) return token;
    if (allowHistory && KEYISH_RE.test(token)) return token; // history key — not in the summary CSV
    errors.push(`panel.${label} "${token}" does not match the frozen export.`);
    return null;
  };

  switch (panel.kind) {
    case 'scalar_by_axis':
    case 'bar_by_axis':
    case 'axis_importance': {
      const metric = metricOk(b.metric, 'metric');
      if (!metric) return null;
      panel.metric = metric;
      if (b.groupby !== undefined || panel.kind !== 'axis_importance') {
        if (
          typeof b.groupby !== 'string' ||
          fromReportSpecKey(b.groupby) === null ||
          resolveFieldColumn(b.groupby, csv) === null
        ) {
          if (panel.kind === 'axis_importance' && b.groupby === undefined) break;
          errors.push(
            `panel.groupby for ${panel.kind} must be a spec-form config key present in the frozen export.`,
          );
          return null;
        }
        panel.groupby = b.groupby;
      }
      panel.agg = panel.agg ?? 'median'; // the across-seeds thesis convention
      break;
    }
    case 'scatter': {
      const x = metricOk(b.x, 'x');
      const y = metricOk(b.metric ?? b.y, 'metric');
      if (!x || !y) return null;
      panel.x = x;
      panel.metric = y;
      break;
    }
    case 'line': {
      const y = metricOk(b.metric ?? b.y, 'metric', true);
      if (!y) return null;
      panel.metric = y;
      if (b.x !== undefined) {
        const x = metricOk(b.x, 'x', true);
        if (!x) return null;
        panel.x = x;
      }
      break;
    }
    case 'parallel_coords': {
      if (!Array.isArray(b.columns) || b.columns.length < 2 || b.columns.length > LIMITS.pcColumns) {
        errors.push(`parallel_coords needs 2–${LIMITS.pcColumns} "columns".`);
        return null;
      }
      const cols: string[] = [];
      for (const c of b.columns) {
        const resolved = metricOk(c, 'columns[]');
        if (!resolved) return null;
        cols.push(resolved);
      }
      panel.columns = cols;
      break;
    }
  }

  return panel;
}
