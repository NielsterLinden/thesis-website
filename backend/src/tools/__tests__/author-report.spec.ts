import { validateReportSpec } from '../../reports/spec';
import { AuthorReportTool } from '../author-report.tool';
import { CsvStore } from '../csv-store';

const H10 = 'config/axes/H10_Model Size Label';
const B1 = 'config/axes/B1_Bias Activation Set';
const AUROC = 'eval_v2/test_auroc';

function synthetic(): CsvStore {
  const columns = [H10, B1, AUROC];
  const rows = [
    { [H10]: 'd256_L6', [B1]: 'none', [AUROC]: '0.90' },
    { [H10]: 'd256_L6', [B1]: 'none', [AUROC]: '0.92' },
    { [H10]: 'd256_L6', [B1]: 'gelu', [AUROC]: '0.80' },
    { [H10]: 'd512_L8', [B1]: 'none', [AUROC]: '0.95' },
  ];
  return new CsvStore(columns, rows);
}

const CTX = {
  entity: 'test-entity',
  sourceProject: 'canonical-runs',
  targetProject: 'thesis-visitor-reports',
};

describe('AuthorReportTool (call 1 of the two-call protocol)', () => {
  const store = synthetic();
  const tool = new AuthorReportTool(store, CTX);

  it('resolves axis IDs, validates, and returns a proposal with true group counts — no save', () => {
    const res = tool.execute({
      title: 'AUROC by B1',
      filters: [{ field: 'H10', op: '==', value: 'd256_L6' }],
      groupby: 'B1',
      intro: 'Median across seeds.',
      panels: [{ kind: 'bar_by_axis', title: 'AUROC by B1', metric: 'test_auroc', groupby: 'B1' }],
    });

    expect(res.isError).toBeFalsy();
    expect(res.proposal).toBeDefined();
    const { spec, summary } = res.proposal!;

    // Axis IDs became unambiguous spec-form keys.
    expect(spec.runset.filters[0].field).toBe('config:axes/H10_Model Size Label.value');
    expect(spec.runset.groupby).toEqual(['config:axes/B1_Bias Activation Set.value']);

    // Routing is server-authoritative.
    expect(spec.entity).toBe('test-entity');
    expect(spec.source_project).toBe('canonical-runs');
    expect(spec.target_project).toBe('thesis-visitor-reports');

    // The §6.3 summary: target project, draft-ness, filters, and real counts.
    expect(summary).toContain('thesis-visitor-reports');
    expect(summary).toContain('DRAFT');
    expect(summary).toContain('N=3 runs');
    expect(summary).toContain('none N=2');
    expect(summary).toContain('gelu N=1');
    expect(summary).toContain('bar_by_axis of eval_v2/test_auroc');

    // The model-facing text demands the confirm-card flow.
    expect(res.content).toContain('VALIDATED');
    expect(res.content).toContain('confirm');

    // What the tool proposed re-validates byte-identically at /reports/save.
    const revalidated = validateReportSpec(spec, { ...CTX, csv: store });
    expect(revalidated.ok).toBe(true);
    if (revalidated.ok) expect(revalidated.spec).toEqual(spec);
  });

  it('defaults the aggregation to median (thesis convention)', () => {
    const res = tool.execute({
      title: 't',
      panels: [{ kind: 'bar_by_axis', metric: 'test_auroc', groupby: 'B1' }],
    });
    expect(res.isError).toBeFalsy();
    const panel = res.proposal!.spec.blocks.find((b) => b.type === 'panel');
    expect(panel && panel.type === 'panel' && panel.agg).toBe('median');
  });

  it('rejects unknown axis IDs with a pointer to axes_lookup', () => {
    const res = tool.execute({
      title: 't',
      filters: [{ field: 'Z9', op: '==', value: 'x' }],
      panels: [{ kind: 'bar_by_axis', metric: 'test_auroc', groupby: 'B1' }],
    });
    expect(res.isError).toBe(true);
    expect(res.content).toContain('Z9');
    expect(res.content).toContain('axes_lookup');
    expect(res.proposal).toBeUndefined();
  });

  it('rejects raw filter-expression strings', () => {
    const res = tool.execute({
      title: 't',
      filters: 'H10 == "d256_L6"',
      panels: [{ kind: 'bar_by_axis', metric: 'test_auroc', groupby: 'B1' }],
    });
    expect(res.isError).toBe(true);
    expect(res.content).toContain('structured');
  });
});
