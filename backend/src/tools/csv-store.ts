import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';

/** Literal sentinel for conditional axes — never NaN/null (thesis convention). */
export const NOT_APPLICABLE = '<not_applicable>';

/** CSV column holding the random seed; the across-seeds aggregation groups over it. */
export const SEED_COLUMN = 'config/axes/R5_Seed';

const AXIS_PREFIX = 'config/axes/';
const METRIC_PREFIX = 'eval_v2/';

export type Row = Record<string, string>;

/**
 * In-memory view of the frozen W&B export (data/04_thesis_final.csv). Loaded
 * once at process start; there is no live W&B read path (Initial_plan.md §0).
 *
 * Column-form gotcha (carried in project memory): the CSV addresses axes as
 * `config/axes/<ID>_<Name>` (slash separator, space in the name, NO `.value`).
 * Callers reason in axis IDs (B1, H10, A3); this store bridges an ID to its
 * column via the `_` that separates the ID from the human name — so "B1"
 * resolves to `config/axes/B1_Bias Activation Set` but never to the sub-axis
 * `config/axes/B1-L1_…` (which carries `B1-`, not `B1_`).
 */
export class CsvStore {
  private readonly columnSet: Set<string>;

  constructor(
    readonly columns: string[],
    readonly rows: Row[],
  ) {
    this.columnSet = new Set(columns);
  }

  static fromFile(path: string): CsvStore {
    const content = readFileSync(path, 'utf8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      bom: true,
      relax_column_count: true,
      trim: false,
    }) as Row[];
    const columns = records.length > 0 ? Object.keys(records[0]) : [];
    return new CsvStore(columns, records);
  }

  hasColumn(name: string): boolean {
    return this.columnSet.has(name);
  }

  /**
   * Resolve a caller token to a real CSV column.
   *   - exact column name -> itself
   *   - axis ID (e.g. "B1", "H10", "B1-L1", "A3-a") -> `config/axes/<ID>_…`
   * Returns null if nothing matches.
   */
  resolveAxisColumn(token: string): string | null {
    if (this.columnSet.has(token)) return token;
    const id = token.trim();
    if (id.length === 0) return null;
    const needle = `${AXIS_PREFIX}${id}_`;
    const matches = this.columns.filter((c) => c.startsWith(needle));
    if (matches.length === 1) return matches[0];
    // Case-insensitive fallback (callers may type "b1").
    const lowerNeedle = `${AXIS_PREFIX}${id.toUpperCase()}_`.toLowerCase();
    const ci = this.columns.filter((c) => c.toLowerCase().startsWith(lowerNeedle));
    return ci.length === 1 ? ci[0] : null;
  }

  /**
   * Resolve a metric token to a summary column.
   *   - exact column name -> itself
   *   - bare name (e.g. "test_auroc") -> `eval_v2/test_auroc` if present
   */
  resolveMetric(token: string): string | null {
    if (this.columnSet.has(token)) return token;
    const prefixed = `${METRIC_PREFIX}${token}`;
    if (this.columnSet.has(prefixed)) return prefixed;
    return null;
  }

  /** Numeric value of a cell, or null for blank / sentinel / non-numeric. */
  static numeric(value: string | undefined): number | null {
    if (value === undefined) return null;
    const v = value.trim();
    if (v === '' || v === NOT_APPLICABLE) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
}

const cache = new Map<string, CsvStore>();

/** Load (and memoise by path) the CSV store so tools and the agent share one copy. */
export function loadCsvStore(path: string): CsvStore {
  const existing = cache.get(path);
  if (existing) return existing;
  const store = CsvStore.fromFile(path);
  cache.set(path, store);
  return store;
}
