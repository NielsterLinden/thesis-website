import { loadConfig } from '../../config';
import { loadAxesReference } from '../axes-reference';
import { AxesLookupTool } from '../axes-lookup.tool';
import { loadCsvStore } from '../csv-store';

describe('AxesLookupTool (real AXES_REFERENCE_V2.md from the pinned submodule)', () => {
  const cfg = loadConfig();
  const tool = new AxesLookupTool(
    loadAxesReference(cfg.axesReferencePath),
    loadCsvStore(cfg.dataCsvPath),
  );

  it('resolves A3 to config key, CSV column, report-spec key, and cites the row (check #6)', async () => {
    const res = await tool.execute({ alias: 'A3' });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('Axis A3 — Attention Type');
    // Bridges the three column forms (project memory: CSV slash-form vs report colon-form)
    expect(res.content).toContain('config/axes/A3_Attention Type');
    expect(res.content).toContain('config:axes/A3_Attention Type.value');
    expect(res.content).toContain('[axes: A3 =');
    expect(res.content).toContain('AXES_REFERENCE_V2.md');
  });

  it('is case-insensitive', async () => {
    const res = await tool.execute({ alias: 'a3' });
    expect(res.content).toContain('Axis A3');
  });

  it('resolves B1 to the top-level Bias Activation Set, never a B1-* sub-axis', async () => {
    const res = await tool.execute({ alias: 'B1' });
    expect(res.content).toContain('config/axes/B1_Bias Activation Set');
    expect(res.content).not.toContain('config/axes/B1-');
  });

  it('refuses an unknown alias rather than inventing a mapping (check #7 spirit)', async () => {
    const res = await tool.execute({ alias: 'Q9' });
    expect(res.isError).toBe(true);
    expect(res.content.toLowerCase()).toContain('unknown axis alias');
  });
});
