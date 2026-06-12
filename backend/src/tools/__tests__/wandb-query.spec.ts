import { loadConfig } from '../../config';
import { CsvStore, loadCsvStore } from '../csv-store';
import { WandbQueryTool } from '../wandb-query.tool';

const H10 = 'config/axes/H10_Model Size Label';
const B1 = 'config/axes/B1_Bias Activation Set';
const SEED = 'config/axes/R5_Seed';
const AUROC = 'eval_v2/test_auroc';

function synthetic(): CsvStore {
  const columns = [H10, B1, SEED, AUROC];
  const rows = [
    { [H10]: 'd256_L6', [B1]: 'none', [SEED]: '0', [AUROC]: '0.90' },
    { [H10]: 'd256_L6', [B1]: 'none', [SEED]: '1', [AUROC]: '0.92' },
    { [H10]: 'd256_L6', [B1]: 'none', [SEED]: '2', [AUROC]: '0.94' },
    { [H10]: 'd256_L6', [B1]: 'none', [SEED]: '3', [AUROC]: '<not_applicable>' },
    { [H10]: 'd256_L6', [B1]: 'gelu', [SEED]: '0', [AUROC]: '0.80' },
    { [H10]: 'd256_L6', [B1]: 'gelu', [SEED]: '1', [AUROC]: '0.82' },
  ];
  return new CsvStore(columns, rows);
}

describe('CsvStore axis/metric resolution', () => {
  const store = synthetic();
  it('resolves an axis ID to the config column via the underscore-after-ID rule', () => {
    expect(store.resolveAxisColumn('B1')).toBe(B1);
    expect(store.resolveAxisColumn('H10')).toBe(H10);
  });
  it('resolves a bare metric name to eval_v2/<name>', () => {
    expect(store.resolveMetric('test_auroc')).toBe(AUROC);
    expect(store.resolveMetric(AUROC)).toBe(AUROC);
  });
  it('treats the sentinel and blanks as non-numeric', () => {
    expect(CsvStore.numeric('<not_applicable>')).toBeNull();
    expect(CsvStore.numeric('')).toBeNull();
    expect(CsvStore.numeric('0.91')).toBeCloseTo(0.91);
  });
});

describe('WandbQueryTool (synthetic, deterministic)', () => {
  const tool = new WandbQueryTool(synthetic());

  it('computes median across seeds, skips the sentinel, reports N, and cites', async () => {
    const res = await tool.execute({
      metric: 'test_auroc',
      filters: [{ field: 'H10', op: '==', value: 'd256_L6' }],
      groupby: 'B1',
      agg: 'median',
    });
    expect(res.isError).toBeFalsy();
    // median([0.90,0.92,0.94]) = 0.92 over 3 numeric seeds, 1 sentinel skipped
    expect(res.content).toContain('none: 0.92 (N=3 seeds, 1 non-numeric skipped)');
    // median([0.80,0.82]) = 0.81 over 2 seeds
    expect(res.content).toContain('gelu: 0.81 (N=2 seeds)');
    expect(res.content).toContain('[wandb:');
    expect(res.content).toContain('groupby=B1');
    expect(res.content).toContain('agg=median');
    expect(res.content).toContain(`metric=${AUROC}`);
  });

  it('defaults to median when agg is omitted', async () => {
    const res = await tool.execute({ metric: 'test_auroc', groupby: 'B1' });
    expect(res.content).toContain('agg=median');
  });

  it('attaches a structured queryResult mirroring the text content (frontend side channel)', async () => {
    const res = await tool.execute({
      metric: 'test_auroc',
      filters: [{ field: 'H10', op: '==', value: 'd256_L6' }],
      groupby: 'B1',
      agg: 'median',
    });
    const qr = res.queryResult;
    expect(qr).toBeDefined();
    expect(qr!.metric).toBe(AUROC);
    expect(qr!.agg).toBe('median');
    expect(qr!.groupby).toEqual(['B1']);
    expect(qr!.filters).toEqual([{ field: 'H10', op: '==', value: 'd256_L6' }]);
    expect(qr!.matching_runs).toBe(6);
    expect(qr!.truncated_groups).toBe(0);
    expect(qr!.groups).toEqual([
      { key: 'gelu', value: 0.81, n: 2, skipped: 0 },
      { key: 'none', value: 0.92, n: 3, skipped: 1 },
    ]);
    // The attached citation is byte-identical to the token in the text — the
    // frontend matches the model's chip against it.
    expect(res.content.trim().endsWith(qr!.citation)).toBe(true);
  });

  it('attaches no queryResult when nothing matches (nothing to visualize)', async () => {
    const res = await tool.execute({
      metric: 'test_auroc',
      filters: [{ field: 'H10', op: '==', value: 'no_such_model' }],
    });
    expect(res.isError).toBeFalsy();
    expect(res.queryResult).toBeUndefined();
  });

  it('rejects an unknown operator (structured triples only, no eval path)', async () => {
    const res = await tool.execute({
      metric: 'test_auroc',
      filters: [{ field: 'B1', op: 'LIKE', value: 'x' }],
    });
    expect(res.isError).toBe(true);
  });

  it('rejects an unknown field and an unknown metric', async () => {
    expect((await tool.execute({ metric: 'test_auroc', filters: [{ field: 'ZZ9', op: '==', value: 'x' }] })).isError).toBe(true);
    expect((await tool.execute({ metric: 'no_such_metric' })).isError).toBe(true);
  });
});

describe('WandbQueryTool (real frozen CSV — acceptance check #4)', () => {
  const cfg = loadConfig();
  const tool = new WandbQueryTool(loadCsvStore(cfg.dataCsvPath));

  it('answers "median test AUROC for d256_L6 grouped by B1" with group counts and a citation', async () => {
    const res = await tool.execute({
      metric: 'test_auroc',
      filters: [{ field: 'H10', op: '==', value: 'd256_L6' }],
      groupby: 'B1',
      agg: 'median',
    });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('410 matching runs'); // 410 d256_L6 runs in the export
    expect(res.content).toContain('none:'); // the largest B1 bucket
    expect(res.content).toMatch(/N=\d+ seeds/);
    expect(res.content).toContain('[wandb:');
    expect(res.content).toContain(`metric=${AUROC}`);
    // A plausible AUROC for this dataset lives in [0.5, 1.0].
    const m = res.content.match(/none: ([0-9.]+) \(N=/);
    expect(m).not.toBeNull();
    const v = Number(m![1]);
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(1.0);
  });
});
