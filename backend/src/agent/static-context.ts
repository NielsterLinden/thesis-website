import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { AppConfig } from '../config';
import { buildSystemPrompt } from './system-prompt';

/**
 * Assembles the static, cacheable prompt prefix: the system prompt, the whole
 * thesis TeX, and the full axes reference. Per Initial_plan.md §5.2/§5.3 the
 * thesis is loaded ONCE into the cached prefix (not fetched per call via a
 * tool) — at Opus 4.7/4.8 the cache read makes the monthly spend cap a
 * comfortable ceiling rather than a tight one.
 *
 * Caching: render order is tools -> system -> messages, so a single
 * cache_control breakpoint on the LAST system block caches the tool
 * definitions AND all three system blocks together. The blocks are byte-stable
 * across requests (no timestamps / per-request IDs), which is what lets the
 * cache actually hit.
 */

const THESIS_FILES_IN_ORDER = [
  'frontmatter/summary.tex',
  'frontmatter/preface.tex',
];

/**
 * Strip LaTeX comments and collapse blank runs before the TeX enters the
 * cached prefix. Comments are not citable content (citations anchor on
 * \section{}/\label{}, which survive), and the prefix is re-read on every
 * agent-loop iteration, so every byte removed is saved on each call. The
 * transform is deterministic, keeping the prefix byte-stable across requests
 * (which the cache hit depends on). Known minor edge: a literal % inside a
 * verbatim environment would be cut — harmless in a model-only view.
 */
export function stripTexForContext(tex: string): string {
  const out: string[] = [];
  let blankRun = 0;
  for (const raw of tex.split('\n')) {
    let line = raw;
    // Prefix of escaped chars (\% stays a literal percent) or non-% chars,
    // up to the first unescaped %, which starts the comment.
    const m = /^((?:\\.|[^%\\])*)%/.exec(line);
    if (m) {
      if (m[1].trim() === '') continue; // comment-only line: drop, no blank left behind
      line = m[1];
    }
    line = line.replace(/\s+$/, ''); // also normalizes CRLF
    if (line === '') {
      blankRun++;
      if (blankRun > 1) continue; // a single blank keeps the paragraph break
    } else {
      blankRun = 0;
    }
    out.push(line);
  }
  return out.join('\n').trim();
}

function listMainmatter(thesisReportDir: string): string[] {
  const dir = join(thesisReportDir, 'mainmatter');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.tex'))
    .sort()
    .map((f) => `mainmatter/${f}`);
}

export interface StaticContext {
  systemBlocks: Anthropic.TextBlockParam[];
  approxChars: number;
  approxTokens: number;
  thesisFiles: string[];
}

export function buildStaticContext(config: AppConfig): StaticContext {
  const thesisReportDir = join(config.thesisSrcDir, 'thesis_report');

  const relFiles = [...THESIS_FILES_IN_ORDER, ...listMainmatter(thesisReportDir)];
  const includedFiles: string[] = [];
  const parts: string[] = [];
  for (const rel of relFiles) {
    const abs = join(thesisReportDir, rel);
    if (!existsSync(abs)) continue;
    const text = stripTexForContext(readFileSync(abs, 'utf8'));
    includedFiles.push(rel);
    // The marker lets the model anchor its [thesis: …] citations to a file and
    // the \section{}/\label{} markers within it. It is added AFTER comment
    // stripping, so it is the one %-line that survives.
    parts.push(`% ===== THESIS FILE: thesis_report/${rel} =====\n${text}`);
  }
  const thesisTeX = parts.join('\n\n');

  const axesText = existsSync(config.axesReferencePath)
    ? readFileSync(config.axesReferencePath, 'utf8')
    : '';

  const systemPrompt = buildSystemPrompt(config, includedFiles);

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: systemPrompt },
    {
      type: 'text',
      text:
        'THESIS SOURCE (LaTeX). This is the full text of the thesis, loaded into ' +
        'context. Ground every thesis claim in this text and cite it as ' +
        '[thesis: §<section or \\label>]. Files are delimited by ' +
        '"===== THESIS FILE: … =====" markers.\n\n' +
        thesisTeX,
    },
    {
      type: 'text',
      text:
        'AXES REFERENCE (AXES_REFERENCE_V2.md, read from the pinned thesis-src ' +
        'submodule). Authoritative mapping of V2 axis IDs to config keys. For a ' +
        'precise, citable single-axis lookup prefer the axes_lookup tool.\n\n' +
        axesText,
      // The single static breakpoint — caches tools + all system blocks.
      cache_control: { type: 'ephemeral' },
    },
  ];

  const approxChars = systemBlocks.reduce((n, b) => n + b.text.length, 0);
  return {
    systemBlocks,
    approxChars,
    approxTokens: Math.round(approxChars / 4),
    thesisFiles: includedFiles,
  };
}
