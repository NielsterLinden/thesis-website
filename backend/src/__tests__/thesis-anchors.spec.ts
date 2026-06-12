import { loadConfig } from '../config';
import { loadThesisAnchors, parseAux, parseToc, ThesisAnchors } from '../thesis-anchors';

describe('parseToc (synthetic)', () => {
  it('maps numbered chapters/sections to their hyperref destinations', () => {
    const toc = [
      '\\contentsline {chapter}{Preface}{i}{chapter*.1}%',
      '\\contentsline {part}{I\\hspace {1em}Framing}{1}{part.1}%',
      '\\contentsline {chapter}{\\numberline {1}Introduction}{2}{chapter.1}%',
      '\\contentsline {section}{\\numberline {1.1}The Standard Model}{3}{section.1.1}%',
      '\\contentsline {subsection}{\\numberline {1.1.1}Particles {with} braces}{3}{subsection.1.1.1}%',
      '\\contentsline {chapter}{\\numberline {A}Appendix Title}{90}{appendix.A}%',
    ].join('\n');
    const anchors: ThesisAnchors = {};
    parseToc(toc, anchors);
    expect(anchors['1']).toBe('chapter.1');
    expect(anchors['1.1']).toBe('section.1.1');
    expect(anchors['1.1.1']).toBe('subsection.1.1.1');
    expect(anchors['A']).toBe('appendix.A');
    // Unnumbered entries (Preface) carry no \numberline and produce no key.
    expect(Object.values(anchors)).not.toContain('chapter*.1');
  });
});

describe('parseAux (synthetic)', () => {
  it('maps labels and eq/fig/tab numbers, skipping @cref entries and nested-brace titles', () => {
    const aux = [
      // Title with nested braces (math + \cite) — the realistic hard case.
      '\\newlabel{fig:intro_sm_particles}{{1.1}{4}{Cross-sections at $\\sqrt {s} = 13\\,\\mathrm {TeV}$~\\cite {ref}}{figure.caption.3}{}}',
      '\\newlabel{fig:intro_sm_particles@cref}{{[figure][1][1]1.1}{[1][4][]4}{}{}{}}',
      '\\newlabel{eq:ch6_diffattn}{{6.1}{49}{Title}{equation.6.1}{}}',
      '\\newlabel{tab:cross_sections}{{1.1}{4}{Title}{table.caption.4}{}}',
      '\\newlabel{sec:intro_atlas}{{1.2}{5}{Title}{section.1.2}{}}',
      '\\newlabel{chapter:Introduction}{{1}{2}{Introduction}{chapter.1}{}}',
    ].join('\n');
    const anchors: ThesisAnchors = {};
    parseAux(aux, anchors);
    expect(anchors['fig:intro_sm_particles']).toBe('figure.caption.3');
    expect(anchors['fig:1.1']).toBe('figure.caption.3');
    expect(anchors['eq:ch6_diffattn']).toBe('equation.6.1');
    expect(anchors['eq:6.1']).toBe('equation.6.1');
    expect(anchors['tab:cross_sections']).toBe('table.caption.4');
    expect(anchors['tab:1.1']).toBe('table.caption.4');
    expect(anchors['sec:intro_atlas']).toBe('section.1.2');
    expect(anchors['1.2']).toBe('section.1.2');
    expect(anchors['chapter:Introduction']).toBe('chapter.1');
    expect(anchors['fig:intro_sm_particles@cref']).toBeUndefined();
  });

  it('does not let an .aux label override a .toc section key', () => {
    const anchors: ThesisAnchors = { '1.2': 'section.1.2' };
    parseAux('\\newlabel{sec:x}{{1.2}{5}{T}{section.1.2}{}}', anchors);
    expect(anchors['1.2']).toBe('section.1.2');
  });
});

describe('loadThesisAnchors (real pinned submodule artifacts)', () => {
  const anchors = loadThesisAnchors(loadConfig());

  it('loads a substantial map from report.toc + report.aux', () => {
    // 184 toc lines + 434 newlabels (≈ half are @cref) put the floor well above 300.
    expect(Object.keys(anchors).length).toBeGreaterThan(300);
  });

  it('resolves the §9 acceptance-check anchors', () => {
    expect(anchors['1.1']).toBe('section.1.1');
    expect(anchors['fig:intro_sm_particles']).toBe('figure.caption.3');
    expect(anchors['eq:6.1']).toBe('equation.6.1');
    expect(anchors['chapter:Introduction']).toBe('chapter.1');
  });

  it('every destination looks like a hyperref name (kind.dotted.path)', () => {
    for (const dest of Object.values(anchors)) {
      expect(dest).toMatch(/^[A-Za-z]+\*?\.[A-Za-z0-9.*]+$/);
    }
  });
});
