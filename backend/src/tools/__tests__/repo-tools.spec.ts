import { loadConfig } from '../../config';
import { RepoGrepTool, RepoReadTool } from '../repo.tools';

const FFN = 'src/thesis_ml/architectures/transformer_classifier/modules/ffn/__init__.py';

describe('RepoReadTool (real pinned submodule)', () => {
  const cfg = loadConfig();
  const read = new RepoReadTool(cfg.thesisSrcDir);

  it('reads a real file and emits a [code: path:lines] anchor', () => {
    const res = read.execute({ path: FFN });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain(`[code: ${FFN}:1-`);
    expect(res.content).toContain('def build_ffn'); // the FFN-type resolver (check #3)
  });

  it('honours an explicit line range', () => {
    const res = read.execute({ path: FFN, start_line: 25, end_line: 35 });
    expect(res.content).toContain(`[code: ${FFN}:25-35]`);
  });

  it('rejects a relative-traversal escape outside thesis-src', () => {
    const res = read.execute({ path: '../../package.json' });
    expect(res.isError).toBe(true);
    expect(res.content.toLowerCase()).toContain('escapes');
  });

  it('rejects an absolute path', () => {
    const res = read.execute({ path: process.platform === 'win32' ? 'C:\\Windows\\win.ini' : '/etc/passwd' });
    expect(res.isError).toBe(true);
  });

  it('returns a clean error for a missing file', () => {
    const res = read.execute({ path: 'src/thesis_ml/does_not_exist.py' });
    expect(res.isError).toBe(true);
    expect(res.content.toLowerCase()).toContain('not found');
  });
});

describe('RepoGrepTool (real pinned submodule)', () => {
  const cfg = loadConfig();
  const grep = new RepoGrepTool(cfg.thesisSrcDir);

  it('locates the FFN factory and anchors each hit (check #3)', () => {
    const res = grep.execute({ pattern: 'def build_ffn' });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain(`[code: ${FFN}:`);
  });

  it('can scope the search to a subdirectory', () => {
    const res = grep.execute({
      pattern: 'ffn_type',
      path: 'src/thesis_ml/architectures/transformer_classifier',
    });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('[code: src/thesis_ml/architectures/transformer_classifier/');
  });

  it('reports cleanly when nothing matches', () => {
    const res = grep.execute({ pattern: 'zzz_nonexistent_token_zzz_42' });
    expect(res.isError).toBeFalsy();
    expect(res.content).toContain('No matches');
  });

  it('rejects an invalid regular expression', () => {
    const res = grep.execute({ pattern: '(' });
    expect(res.isError).toBe(true);
  });
});
