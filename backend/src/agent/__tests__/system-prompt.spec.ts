import { AppConfig } from '../../config';
import { buildSystemPrompt } from '../system-prompt';

const baseConfig = {
  anthropicModel: 'claude-test-model',
  reportsEnabled: false,
  wandbEntity: 'test-entity',
  wandbTargetProject: 'thesis-visitor-reports',
} as AppConfig;

const thesisFiles = ['frontmatter/summary.tex', 'mainmatter/04_best_input_representation.tex'];

describe('buildSystemPrompt', () => {
  const prompt = buildSystemPrompt(baseConfig, thesisFiles);

  it('contains the grading easter egg reply verbatim, quotation marks included', () => {
    expect(prompt).toContain(
      '"Good evening Mr/Ms Supervisor, I\'ve been expecting you." Obviously a 10/10!',
    );
  });

  it('scopes the easter egg to grading questions and exempts it from the citation contract', () => {
    expect(prompt).toContain('SCRIPTED EXCEPTION: THE GRADING QUESTION');
    expect(prompt).toContain('citation contract does not apply to this one reply');
  });

  it('instructs the model to batch independent tool calls into one turn', () => {
    expect(prompt).toContain('Batch independent lookups');
    expect(prompt).toContain('parallel tool calls');
  });

  it('tells the model a budget-exhausted note means answer from gathered evidence', () => {
    expect(prompt).toContain('hard tool-call budget');
    expect(prompt).toContain('beats a refusal');
  });

  it('only advertises report authoring when Phase 2 is enabled', () => {
    expect(prompt).not.toContain('author_report');
    const phase2 = buildSystemPrompt({ ...baseConfig, reportsEnabled: true } as AppConfig, thesisFiles);
    expect(phase2).toContain('author_report');
  });
});
