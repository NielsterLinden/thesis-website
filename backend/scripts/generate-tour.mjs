// Regenerates web/src/tour.json: the guided-tour cards on the landing page.
//
// Each tour stop is a REAL agent answer captured once through the normal
// /chat endpoint and committed, so the landing page can demonstrate the
// assistant (citation chips, rendered math, query-result tables) at zero
// inference cost and without the password. Re-run after any change that
// alters answers visibly (system prompt, citation shapes, query side
// channel), against a backend running the deployment model.
//
// Usage (backend running locally with a real ANTHROPIC_API_KEY):
//   SITE_URL=http://localhost:8080 SITE_PASSWORD=... node backend/scripts/generate-tour.mjs
// SITE_PASSWORD falls back to the value in the repo-root .env.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const outPath = resolve(repoRoot, 'web', 'src', 'tour.json');

const SITE_URL = process.env.SITE_URL ?? 'http://localhost:8080';

function envPassword() {
  if (process.env.SITE_PASSWORD) return process.env.SITE_PASSWORD;
  const envFile = resolve(repoRoot, '.env');
  if (!existsSync(envFile)) return '';
  const m = /^SITE_PASSWORD=(.*)$/m.exec(readFileSync(envFile, 'utf8'));
  return m ? m[1].trim() : '';
}

// One stop per tool surface (mirroring the §9 acceptance checks), plus one
// for rendered math and one demonstrating the refusal contract.
const STOPS = [
  {
    id: 'thesis',
    caption: 'A thesis-content question, answered from the TeX in context. The chips deep-link into the PDF.',
    question: 'Summarize the input-representation chapter.',
  },
  {
    id: 'code',
    caption: 'A code question, answered by grepping and reading the pinned snapshot, never from memory.',
    question: 'How is the FFN type resolved between standard, KAN, and MoE?',
  },
  {
    id: 'wandb',
    caption:
      'A results question over the frozen W&B export. The table below the answer is the exact aggregate the model saw; click the [wandb: …] chip to reveal it.',
    question: 'What is the median test AUROC for the d256_L6 baseline, grouped by B1?',
  },
  {
    id: 'axes',
    caption: 'An experiment-axis question: alias -> config key -> implementing code, with both cited.',
    question: 'What does A3 control, and where in the code is it implemented?',
  },
  {
    id: 'math',
    caption: 'Equations are quoted from the TeX and rendered.',
    question: 'Quote the differential attention equation from the thesis and briefly explain each term.',
  },
  {
    id: 'refusal',
    caption:
      'A question none of the three sources can answer. The contract requires a refusal, not a confident guess.',
    question: 'What is the current exchange rate between the euro and the dollar?',
  },
];

async function ask(question, password) {
  const res = await fetch(`${SITE_URL}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-site-password': password },
    body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
  });
  if (!res.ok) throw new Error(`POST /chat -> ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const password = envPassword();
if (!password) {
  console.error('No SITE_PASSWORD in the environment or .env; cannot call the gated /chat.');
  process.exit(1);
}

const meta = await fetch(`${SITE_URL}/health`).catch(() => null);
if (!meta || !meta.ok) {
  console.error(`No backend at ${SITE_URL} (start one with a real ANTHROPIC_API_KEY first).`);
  process.exit(1);
}

// The model occasionally opens with post-tool filler ("Perfect! Now I…")
// despite the prompt; for a committed examiner-facing card, take another
// sample instead of shipping it.
const FILLER_RE = /^(perfect|great|excellent|now i\b|done[.!])/i;

const items = [];
for (const stop of STOPS) {
  process.stdout.write(`[${stop.id}] ${stop.question} … `);
  let r;
  for (let attempt = 1; ; attempt++) {
    r = await ask(stop.question, password);
    if (!FILLER_RE.test(r.answer.trim()) || attempt >= 3) break;
    process.stdout.write(`(retry ${attempt}: filler opener) … `);
  }
  if (r.capped) console.warn(`\n  WARNING: turn was capped; consider re-running this stop.`);
  items.push({
    id: stop.id,
    question: stop.question,
    caption: stop.caption,
    answer: r.answer,
    tool_calls: r.tool_calls,
    usage: r.usage,
    query_results: r.query_results ?? [],
  });
  console.log(`ok (${r.tool_calls.length} tool calls, ${r.usage.output_tokens} out tokens)`);
}

writeFileSync(
  outPath,
  `${JSON.stringify({ generated_at: new Date().toISOString(), model: process.env.ANTHROPIC_MODEL ?? null, items }, null, 2)}\n`,
);
console.log(`Wrote ${items.length} tour stops to ${outPath}. Rebuild the frontend to bundle them.`);
