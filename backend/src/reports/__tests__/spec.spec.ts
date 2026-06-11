import { CsvStore } from '../../tools/csv-store';
import { SpecContext, validateReportSpec } from '../spec';

const H10 = 'config/axes/H10_Model Size Label';
const B1 = 'config/axes/B1_Bias Activation Set';
const AUROC = 'eval_v2/test_auroc';

const H10_KEY = 'config:axes/H10_Model Size Label.value';
const B1_KEY = 'config:axes/B1_Bias Activation Set.value';

function ctx(): SpecContext {
  const columns = [H10, B1, AUROC, 'eval_v2/num_parameters_total'];
  const rows = [
    { [H10]: 'd256_L6', [B1]: 'none', [AUROC]: '0.90', 'eval_v2/num_parameters_total': '100' },
    { [H10]: 'd256_L6', [B1]: 'gelu', [AUROC]: '0.80', 'eval_v2/num_parameters_total': '100' },
  ];
  return {
    entity: 'test-entity',
    sourceProject: 'canonical-runs',
    targetProject: 'thesis-visitor-reports',
    csv: new CsvStore(columns, rows),
  };
}

function validRaw(): Record<string, unknown> {
  return {
    title: 'AUROC by physics-bias activation',
    description: 'Median across seeds.',
    runset: {
      filters: [{ field: H10_KEY, op: '==', value: 'd256_L6' }],
      groupby: [B1_KEY],
    },
    blocks: [
      { type: 'heading', text: 'AUROC by B1' },
      { type: 'prose', text: 'Baseline held fixed.' },
      { type: 'panel', kind: 'bar_by_axis', metric: AUROC, groupby: B1_KEY, agg: 'median' },
    ],
  };
}

describe('validateReportSpec', () => {
  it('accepts the §6.2 example shape and fills server-authoritative routing', () => {
    const res = validateReportSpec(validRaw(), ctx());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.spec.entity).toBe('test-entity');
    expect(res.spec.source_project).toBe('canonical-runs');
    expect(res.spec.target_project).toBe('thesis-visitor-reports');
    expect(res.spec.runset.filters).toEqual([{ field: H10_KEY, op: '==', value: 'd256_L6' }]);
    expect(res.spec.runset.groupby).toEqual([B1_KEY]);
    expect(res.spec.blocks).toHaveLength(3);
  });

  it('ignores caller-supplied entity/source but rejects a mismatching explicit target', () => {
    const raw = { ...validRaw(), entity: 'attacker', source_project: 'other' };
    const res = validateReportSpec(raw, ctx());
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.spec.entity).toBe('test-entity');

    const evil = { ...validRaw(), target_project: 'canonical-runs' };
    const res2 = validateReportSpec(evil, ctx());
    expect(res2.ok).toBe(false);
    if (!res2.ok) expect(res2.errors.join(' ')).toContain('target_project');
  });

  it('rejects raw filter-expression strings at both levels', () => {
    const asString = validRaw();
    (asString.runset as Record<string, unknown>).filters = 'config.x == 1';
    const res = validateReportSpec(asString, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toContain('structured');

    const entryString = validRaw();
    (entryString.runset as Record<string, unknown>).filters = ['name == "abc"'];
    const res2 = validateReportSpec(entryString, ctx());
    expect(res2.ok).toBe(false);
  });

  it('rejects an op outside the closed set', () => {
    const raw = validRaw();
    ((raw.runset as Record<string, unknown>).filters as unknown[])[0] = {
      field: H10_KEY,
      op: '=~',
      value: '.*',
    };
    const res = validateReportSpec(raw, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toContain('filter.op');
  });

  it('rejects fields that do not exist in the frozen export', () => {
    const raw = validRaw();
    ((raw.runset as Record<string, unknown>).filters as unknown[])[0] = {
      field: 'config:axes/Z9_Made Up.value',
      op: '==',
      value: 'x',
    };
    const res = validateReportSpec(raw, ctx());
    expect(res.ok).toBe(false);
  });

  it('rejects unknown panel kinds and panel-free reports', () => {
    const raw = validRaw();
    (raw.blocks as unknown[])[2] = { type: 'panel', kind: 'pie_chart', metric: AUROC };
    expect(validateReportSpec(raw, ctx()).ok).toBe(false);

    const noPanels = validRaw();
    noPanels.blocks = [{ type: 'prose', text: 'words only' }];
    const res = validateReportSpec(noPanels, ctx());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.errors.join(' ')).toContain('at least one panel');
  });

  it('requires a config-key groupby for bar_by_axis and defaults agg to median', () => {
    const raw = validRaw();
    (raw.blocks as unknown[])[2] = { type: 'panel', kind: 'bar_by_axis', metric: AUROC };
    expect(validateReportSpec(raw, ctx()).ok).toBe(false);

    const noAgg = validRaw();
    (noAgg.blocks as unknown[])[2] = { type: 'panel', kind: 'bar_by_axis', metric: AUROC, groupby: B1_KEY };
    const res = validateReportSpec(noAgg, ctx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      const panel = res.spec.blocks[2];
      expect(panel.type === 'panel' && panel.agg).toBe('median');
    }
  });

  it('validates scatter/parallel_coords columns against the export, allows history keys for line', () => {
    const scatter = validRaw();
    (scatter.blocks as unknown[])[2] = {
      type: 'panel',
      kind: 'scatter',
      x: 'eval_v2/num_parameters_total',
      metric: AUROC,
    };
    expect(validateReportSpec(scatter, ctx()).ok).toBe(true);

    const pc = validRaw();
    (pc.blocks as unknown[])[2] = { type: 'panel', kind: 'parallel_coords', columns: [B1_KEY, AUROC] };
    expect(validateReportSpec(pc, ctx()).ok).toBe(true);

    const line = validRaw();
    (line.blocks as unknown[])[2] = { type: 'panel', kind: 'line', metric: 'val/auroc', x: 'epoch' };
    expect(validateReportSpec(line, ctx()).ok).toBe(true);

    const lineEvil = validRaw();
    (lineEvil.blocks as unknown[])[2] = { type: 'panel', kind: 'line', metric: 'a" or "1"=="1' };
    expect(validateReportSpec(lineEvil, ctx()).ok).toBe(false);
  });
});
