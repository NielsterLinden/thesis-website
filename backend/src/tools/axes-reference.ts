import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface AxisEntry {
  id: string;
  name: string;
  /** 1-indexed line of the heading in the source file (for citation). */
  line: number;
  /** Parsed bullet fields: Config, W&B, axes key, Options, Default, Prerequisite, Note. */
  fields: Record<string, string>;
  /** Full block text (heading + body) for returning verbatim. */
  raw: string;
}

// Headings look like `### G1 · Task Type` / `#### T1-a · PID Embedding Mode`.
// The `·` (U+00B7) separator distinguishes axis entries from group headings,
// which use an em dash (`### T — Tokenizer`).
const HEADING_RE = /^#{2,6}\s+(\S+)\s+·\s+(.+?)\s*$/;
const ANY_HEADING_RE = /^#{1,6}\s+/;
const FIELD_RE = /^\s*-\s*\*\*([^:*]+):\*\*\s*(.*)$/;

/**
 * Parsed view of thesis-src/docs/AXES_REFERENCE_V2.md. Read from the pinned
 * submodule (not a copy under backend/) so the agent's axis ground-truth is
 * locked to the same commit as the code and TeX (Initial_plan.md §3).
 */
export class AxesReference {
  private readonly byId = new Map<string, AxisEntry>();

  constructor(
    readonly sourceName: string,
    entries: AxisEntry[],
  ) {
    for (const e of entries) this.byId.set(e.id.toUpperCase(), e);
  }

  static fromFile(path: string): AxesReference {
    const text = readFileSync(path, 'utf8');
    const lines = text.split(/\r?\n/);
    const entries: AxisEntry[] = [];

    for (let i = 0; i < lines.length; i++) {
      const m = HEADING_RE.exec(lines[i]);
      if (!m) continue;
      const id = m[1];
      if (!/^[A-Z]\d/.test(id)) continue; // axis IDs start uppercase-letter + digit

      const bodyLines = [lines[i]];
      let j = i + 1;
      for (; j < lines.length; j++) {
        if (ANY_HEADING_RE.test(lines[j])) break;
        bodyLines.push(lines[j]);
      }

      const fields: Record<string, string> = {};
      for (const bl of bodyLines) {
        const fm = FIELD_RE.exec(bl);
        if (fm) fields[fm[1].trim()] = fm[2].trim();
      }

      entries.push({
        id,
        name: m[2].trim(),
        line: i + 1,
        fields,
        raw: bodyLines.join('\n').trim(),
      });
    }

    return new AxesReference(basename(path), entries);
  }

  lookup(id: string): AxisEntry | null {
    return this.byId.get(id.trim().toUpperCase()) ?? null;
  }

  /** All known axis IDs, in document order. */
  ids(): string[] {
    return [...this.byId.values()].sort((a, b) => a.line - b.line).map((e) => e.id);
  }
}

const cache = new Map<string, AxesReference>();

export function loadAxesReference(path: string): AxesReference {
  const existing = cache.get(path);
  if (existing) return existing;
  const ref = AxesReference.fromFile(path);
  cache.set(path, ref);
  return ref;
}
