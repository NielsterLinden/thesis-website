// Seeds / refreshes the figure gallery from the pinned thesis submodule.
//
// For every \label{fig:...} the compiled thesis recorded a number + page +
// caption in thesis_report/report.aux, this script:
//   1. finds the figure's source image via \includegraphics in the .tex,
//   2. copies that source PDF (or PNG) into web/public/figures/<id>.pdf,
//   3. rasterises the PDF to web/public/figures/<id>.png (poppler pdftoppm),
//   4. merges an entry into web/public/figures.json.
//
// The manifest is the gallery's source of truth and is HAND-EDITED: this
// script only ever fills source-derived fields (png/pdf/chapter/number/
// thesisLabel/thesisPage) and seeds blank `title`/`description` from the LaTeX
// caption. It NEVER overwrites an author-written title/description/models/
// wandbUrl. Run it again after a thesis-snapshot bump (Initial_plan.md §3.1 /
// CLAUDE.md thesis-refresh workflow):
//
//   node backend/scripts/figures-manifest.mjs
//
// Rasteriser: poppler `pdftoppm`. Found on PATH, else under the MiKTeX install
// in %LOCALAPPDATA% (the same toolchain that builds the thesis), else override
// with FIG_PDFTOPPM=/path/to/pdftoppm. Without it the script still copies PDFs
// and writes the manifest, just skips the PNGs (the gallery needs them, so a
// warning is logged).

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const thesisReport = resolve(repoRoot, 'thesis-src', 'thesis_report');
const auxPath = resolve(thesisReport, 'report.aux');
const outDir = resolve(repoRoot, 'web', 'public', 'figures');
const manifestPath = resolve(repoRoot, 'web', 'public', 'figures.json');
const RASTER_WIDTH = 1400; // px of the longest horizontal dimension

// ---------------------------------------------------------------------------
// LaTeX brace scanning (shared shape with backend/src/thesis-anchors.ts).
// ---------------------------------------------------------------------------

/** Read one balanced {...} group starting at text[pos] (must be '{'); returns
 *  the inner content and the index just past the closing brace, or null. */
function readGroup(text, pos) {
  if (text[pos] !== '{') return null;
  let depth = 0;
  for (let i = pos; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return { content: text.slice(pos + 1, i), next: i + 1 };
    }
  }
  return null;
}

/** report.aux figure labels -> {number, page, caption}. Each entry is
 *  \newlabel{fig:x}{{num}{page}{caption}{dest}{}} (caption may nest braces, so
 *  this is a brace-aware scan). @cref bookkeeping entries are skipped. */
function parseAuxFigures(aux) {
  const out = new Map();
  const MARK = '\\newlabel{';
  let pos = 0;
  for (;;) {
    const at = aux.indexOf(MARK, pos);
    if (at < 0) break;
    const label = readGroup(aux, at + MARK.length - 1);
    if (!label) break;
    const args = readGroup(aux, label.next);
    pos = args ? args.next : label.next;
    if (!args) continue;
    const name = label.content;
    if (!name.startsWith('fig:') || name.endsWith('@cref')) continue;

    const groups = [];
    let p = 0;
    while (p < args.content.length && groups.length < 4) {
      const g = readGroup(args.content, p);
      if (!g) break;
      groups.push(g.content);
      p = g.next;
    }
    const [number, page, caption, dest] = groups;
    if (!dest || !dest.startsWith('figure')) continue;
    out.set(name, { number, page: Number(page) || null, caption: caption ?? '' });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Figure environments in the .tex: label -> source image file.
// ---------------------------------------------------------------------------

function texFiles(dir) {
  const found = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === '_design' || ent.name === 'figures') continue;
      found.push(...texFiles(full));
    } else if (ent.isFile() && extname(ent.name) === '.tex') {
      found.push(full);
    }
  }
  return found;
}

const INCLUDE_RE = /\\includegraphics\s*(?:\[[^\]]*\])?\s*\{([^}]*)\}/g;
const LABEL_RE = /\\label\s*\{([^}]*)\}/g;
const FIGURE_RE = /\\begin\{figure\*?\}([\s\S]*?)\\end\{figure\*?\}/g;

/** Map each fig: label to its source image path (relative to thesis_report),
 *  pairing every label with the nearest preceding \includegraphics in the same
 *  figure environment (so a subfigure label resolves to its own panel and a
 *  single-image figure resolves to that image). */
function mapLabelsToImages() {
  const map = new Map();
  for (const file of texFiles(resolve(thesisReport, 'mainmatter'))) {
    const tex = readFileSync(file, 'utf8');
    for (const block of tex.matchAll(FIGURE_RE)) {
      const body = block[1];
      const images = [...body.matchAll(INCLUDE_RE)].map((m) => ({ index: m.index ?? 0, path: m[1].trim() }));
      if (images.length === 0) continue;
      for (const lm of body.matchAll(LABEL_RE)) {
        const name = lm[1].trim();
        if (!name.startsWith('fig:') || map.has(name)) continue;
        const at = lm.index ?? 0;
        const preceding = images.filter((im) => im.index < at);
        const chosen = (preceding.length ? preceding[preceding.length - 1] : images[0]).path;
        map.set(name, chosen);
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Helpers: slugs, chapters, caption cleanup, rasteriser discovery.
// ---------------------------------------------------------------------------

function slug(label) {
  return label
    .replace(/^fig:/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** "1.1" -> "Ch 1"; "A.2" -> "App A". Used as the gallery group heading. */
function chapterOf(number) {
  const head = (number ?? '').split('.')[0];
  if (!head) return 'Other';
  return /^[A-Za-z]/.test(head) ? `App ${head.toUpperCase()}` : `Ch ${head}`;
}

/** Best-effort LaTeX -> readable markdown for the seed caption. Math ($...$) is
 *  left verbatim for KaTeX; everything else is cleaned aggressively (cites,
 *  units, residual macros stripped) since text-mode backslashes are never meant
 *  to survive. The author polishes from here, so this only has to be close. */
function cleanCaption(s) {
  const out = s
    .split(/(\$[^$]*\$)/)
    .map((part, i) => {
      if (i % 2 === 1) return part; // math segment: leave for KaTeX
      let t = part;
      t = t.replace(/\\(?:cite[a-z]*|autoref|ref|cref|Cref|label|protect|relax|wandbicon)\s*\{[^{}]*\}/g, '');
      t = t.replace(/\\SI\s*\{([^{}]*)\}\s*\{[^{}]*\}/g, '$1'); // siunitx \SI{n}{unit} -> n
      t = t.replace(/\\(?:num|SIrange)\s*\{([^{}]*)\}(?:\s*\{[^{}]*\})?/g, '$1');
      t = t.replace(/\\si\s*\{[^{}]*\}/g, '');
      for (let k = 0; k < 3; k++) t = t.replace(/\\[a-zA-Z]+\s*\{([^{}]*)\}/g, '$1'); // unwrap \texttt{x} etc
      t = t.replace(/\\[a-zA-Z]+/g, ''); // drop residual bare control words (units, \relax)
      t = t.replace(/~/g, ' ');
      t = t.replace(/---?/g, '-'); // house style: no em dashes
      t = t.replace(/\\([%&#_])/g, '$1');
      return t;
    })
    .join('');
  return out.replace(/[ \t]+/g, ' ').replace(/\s+([.,;:])/g, '$1').trim();
}

/** First sentence of the (already-cleaned) caption, capped, as a seed title. */
function titleFrom(caption, label) {
  const flat = caption.replace(/\$[^$]*\$/g, '').replace(/\s+/g, ' ').trim();
  // No usable caption (e.g. an unlabelled subfigure): read the \label itself.
  if (!flat) {
    return label
      .replace(/^fig:/, '')
      .replace(/^ch\d+[-_]/i, '')
      .replace(/[-_]/g, ' ')
      .trim();
  }
  const stop = flat.search(/\.\s/);
  let t = (stop > 0 ? flat.slice(0, stop) : flat).trim();
  if (t.length > 90) t = `${t.slice(0, 87).trimEnd()}…`;
  return t.replace(/[.\s]+$/, '');
}

function findPdftoppm() {
  const candidates = [
    process.env.FIG_PDFTOPPM,
    'pdftoppm',
    process.env.LOCALAPPDATA &&
      join(process.env.LOCALAPPDATA, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64', 'pdftoppm.exe'),
  ].filter(Boolean);
  for (const cand of candidates) {
    try {
      execFileSync(cand, ['-h'], { stdio: 'ignore' });
      return cand; // ran cleanly
    } catch (e) {
      if (e && e.code !== 'ENOENT') return cand; // present but -h exits nonzero
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

if (!existsSync(auxPath)) {
  console.error(`No report.aux at ${auxPath}. Run \`git submodule update --init\` first.`);
  process.exit(1);
}

const auxFigs = parseAuxFigures(readFileSync(auxPath, 'utf8'));
const labelImages = mapLabelsToImages();
mkdirSync(outDir, { recursive: true });

const pdftoppm = findPdftoppm();
if (!pdftoppm) {
  console.warn('! pdftoppm not found — PDFs will be copied but PNGs not generated.');
  console.warn('  Install poppler / MiKTeX, or set FIG_PDFTOPPM=/path/to/pdftoppm, then re-run.');
}

const existing = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : [];
const byId = new Map(existing.map((e) => [e.id, e]));

let mapped = 0;
let rasterised = 0;
const skipped = [];

for (const [label, aux] of auxFigs) {
  const rel = labelImages.get(label);
  if (!rel) {
    skipped.push(`${label} (no \\includegraphics found)`);
    continue;
  }
  let src = resolve(thesisReport, rel);
  if (!existsSync(src) && !extname(src)) {
    src = existsSync(`${src}.pdf`) ? `${src}.pdf` : `${src}.png`;
  }
  if (!existsSync(src)) {
    skipped.push(`${label} (missing source ${rel})`);
    continue;
  }

  const id = slug(label);
  const ext = extname(src).toLowerCase();
  const prev = byId.get(id) ?? {};
  const entry = { ...prev, id, chapter: chapterOf(aux.number), number: aux.number };

  if (ext === '.png') {
    copyFileSync(src, join(outDir, `${id}.png`));
    entry.png = `/figures/${id}.png`;
    delete entry.pdf;
  } else {
    copyFileSync(src, join(outDir, `${id}.pdf`));
    entry.pdf = `/figures/${id}.pdf`;
    entry.png = `/figures/${id}.png`;
    if (pdftoppm) {
      try {
        execFileSync(
          pdftoppm,
          ['-png', '-singlefile', '-scale-to-x', String(RASTER_WIDTH), '-scale-to-y', '-1', src, join(outDir, id)],
          { stdio: 'ignore' },
        );
        rasterised++;
      } catch (e) {
        skipped.push(`${label} (pdftoppm failed: ${e.message ?? e})`);
      }
    }
  }

  // Source-derived fields always refresh; author-owned fields only seed.
  const caption = cleanCaption(aux.caption);
  entry.thesisLabel = label;
  if (aux.page) entry.thesisPage = aux.page;
  if (!entry.title) entry.title = titleFrom(caption, label);
  if (!entry.description) entry.description = caption;
  if (entry.models === undefined) entry.models = '';
  if (entry.wandbUrl === undefined) entry.wandbUrl = '';

  byId.set(id, entry);
  mapped++;
}

const chapterRank = (c) => {
  const m = /^Ch (\d+)/.exec(c);
  if (m) return Number(m[1]);
  const a = /^App ([A-Z])/.exec(c);
  if (a) return 1000 + a[1].charCodeAt(0);
  return 9999;
};
const numRank = (n) => (n ?? '').split('.').map((x) => Number(x) || 0);

const manifest = [...byId.values()].sort((a, b) => {
  const c = chapterRank(a.chapter) - chapterRank(b.chapter);
  if (c) return c;
  const [a1 = 0, a2 = 0] = numRank(a.number);
  const [b1 = 0, b2 = 0] = numRank(b.number);
  return a1 - b1 || a2 - b2 || a.id.localeCompare(b.id);
});

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Figures: ${mapped} mapped, ${rasterised} rasterised, ${manifest.length} in manifest.`);
console.log(`Manifest -> ${manifestPath}`);
if (skipped.length) {
  console.log(`Skipped ${skipped.length} (add by hand if wanted):`);
  for (const s of skipped) console.log(`  - ${s}`);
}
