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
    const text = readFileSync(abs, 'utf8');
    includedFiles.push(rel);
    // The marker lets the model anchor its [thesis: …] citations to a file and
    // the \section{}/\label{} markers within it.
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
