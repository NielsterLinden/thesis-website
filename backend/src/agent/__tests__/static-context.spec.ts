import { stripTexForContext } from '../static-context';

describe('stripTexForContext', () => {
  it('drops whole-line comments without leaving a blank line behind', () => {
    expect(stripTexForContext('alpha\n% a comment\nbeta')).toBe('alpha\nbeta');
    expect(stripTexForContext('alpha\n   % indented comment\nbeta')).toBe('alpha\nbeta');
  });

  it('strips trailing comments but keeps the code before them', () => {
    expect(stripTexForContext('\\section{Results} % TODO tighten')).toBe('\\section{Results}');
  });

  it('keeps escaped percents (\\%) as literal content', () => {
    expect(stripTexForContext('a rate of 95\\% overall')).toBe('a rate of 95\\% overall');
    expect(stripTexForContext('95\\% kept % comment gone')).toBe('95\\% kept');
  });

  it('collapses runs of blank lines to a single paragraph break', () => {
    expect(stripTexForContext('alpha\n\n\n\nbeta')).toBe('alpha\n\nbeta');
  });

  it('normalizes CRLF and trailing whitespace', () => {
    expect(stripTexForContext('alpha  \r\nbeta\t\r\n')).toBe('alpha\nbeta');
  });

  it('preserves \\section and \\label lines that citations anchor on', () => {
    const tex = '\\section{Input}\\label{sec:input}\n% noise\nBody text.';
    expect(stripTexForContext(tex)).toBe('\\section{Input}\\label{sec:input}\nBody text.');
  });
});
