// Regenerates data/04_thesis_final_lean.csv from data/04_thesis_final.csv.
//
// The lean file is what the backend loads (config.dataCsvPath) and what
// /runs.csv serves for download: identical rows, minus the six array-payload
// columns below — ROC/PR curves and score histograms hold ~93% of the bytes
// (34.5 MB -> 2.7 MB) and are unusable by wandb_query, which aggregates
// scalars only. The full export stays in the repo as the archival artifact
// and the input to this script.
//
// Run from anywhere (part of the thesis-refresh workflow, Initial_plan.md §3.1):
//   node backend/scripts/make-lean-csv.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';

const DROP = new Set([
  'eval_v2/roc_fpr',
  'eval_v2/roc_tpr',
  'eval_v2/pr_precision',
  'eval_v2/pr_recall',
  'eval_v2/score_hist_signal',
  'eval_v2/score_hist_background',
]);

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const srcPath = resolve(repoRoot, 'data', '04_thesis_final.csv');
const outPath = resolve(repoRoot, 'data', '04_thesis_final_lean.csv');

const rows = parse(readFileSync(srcPath, 'utf8'), {
  bom: true,
  skip_empty_lines: true,
  relax_column_count: true,
});

const header = rows[0];
const keep = header.map((name, i) => (DROP.has(name) ? -1 : i)).filter((i) => i >= 0);
const missing = [...DROP].filter((name) => !header.includes(name));
if (missing.length > 0) {
  // A refreshed export may rename columns; fail loudly rather than silently
  // shipping a "lean" file that still carries a heavy payload.
  throw new Error(`expected heavy columns not found in ${srcPath}: ${missing.join(', ')}`);
}

function cell(value) {
  const v = value ?? '';
  return /[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v;
}

const out = rows
  .map((row) => keep.map((i) => cell(row[i])).join(','))
  .join('\r\n');
writeFileSync(outPath, `${out}\r\n`);

console.log(
  `wrote ${outPath}: ${rows.length - 1} rows, ${keep.length} of ${header.length} columns ` +
    `(${(out.length / 1e6).toFixed(2)} MB)`,
);
