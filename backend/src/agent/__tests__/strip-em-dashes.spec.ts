import { stripEmDashes } from '../agent.service';

describe('stripEmDashes (the no-em-dash style contract, enforced server-side)', () => {
  it('replaces a spaced em dash with a comma', () => {
    expect(stripEmDashes('patterns cancel out — only the signal remains')).toBe(
      'patterns cancel out, only the signal remains',
    );
  });

  it('replaces an unspaced em dash too', () => {
    expect(stripEmDashes('a—b')).toBe('a, b');
  });

  it('leaves inline code and fenced blocks untouched', () => {
    const fenced = '```\nx — y\n```';
    expect(stripEmDashes(fenced)).toBe(fenced);
    expect(stripEmDashes('see `a — b` here')).toBe('see `a — b` here');
  });

  it('is a no-op on clean text', () => {
    const clean = 'median, not mean - across seeds (B1).';
    expect(stripEmDashes(clean)).toBe(clean);
  });
});
