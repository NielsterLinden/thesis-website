import { isPlaceholder, loadConfig } from '../config';
import { MetaController } from '../meta.controller';

// Override the W&B fields explicitly rather than trusting the machine's .env:
// the assertions must hold on a dev box with real credentials configured.
function makeController(overrides: { wandbEntity: string; wandbSourceProject: string }) {
  return new MetaController({ ...loadConfig(), ...overrides });
}

describe('GET /meta', () => {
  it('omits the W&B browse URLs while the env holds .env.example placeholders', () => {
    const meta = makeController({
      wandbEntity: 'your-wandb-entity',
      wandbSourceProject: 'your-frozen-canonical-project',
    }).meta();
    expect(meta.wandb_runs_url).toBeNull();
    expect(meta.wandb_reports_url).toBeNull();
    expect(meta.wandb_visitor_reports_url).toBeNull();
    // The citation-link contract is independent of W&B config.
    expect(meta.thesis_repo_url).toMatch(/^https:\/\//);
    expect(meta.thesis_src_commit).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it('builds the runs-table and reports-list URLs from entity + source project', () => {
    const meta = makeController({
      wandbEntity: 'nterlind-nikhef',
      wandbSourceProject: 'thesis-ml',
    }).meta();
    expect(meta.wandb_runs_url).toBe('https://wandb.ai/nterlind-nikhef/thesis-ml/table');
    expect(meta.wandb_reports_url).toBe('https://wandb.ai/nterlind-nikhef/thesis-ml/reportlist');
    // The visitor-reports project (default target) is browsable on the same gate.
    expect(meta.wandb_visitor_reports_url).toBe(
      'https://wandb.ai/nterlind-nikhef/thesis-visitor-reports/reportlist',
    );
  });
});

describe('isPlaceholder', () => {
  it('matches the .env.example placeholder contract', () => {
    expect(isPlaceholder('')).toBe(true);
    expect(isPlaceholder('REPLACE_ME')).toBe(true);
    expect(isPlaceholder('your-wandb-entity')).toBe(true);
    expect(isPlaceholder('nterlind-nikhef')).toBe(false);
  });
});
