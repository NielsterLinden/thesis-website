import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { PathEscapeError, resolveWithinRoot } from './paths';
import { Tool, ToolDefinition, ToolResult, toolError } from './types';

// Caps so a broad pattern or a huge file cannot flood the model context
// (Initial_plan.md §5.3, §14). Every byte returned is uncached conversation
// input that rides along all later loop iterations, so the defaults are kept
// tight; the truncation notes tell the model how to ask for more.
const GREP_DEFAULT_MATCHES = 50;
const GREP_MAX_MATCHES = 200; // reachable only via an explicit max_results
const GREP_MAX_BYTES = 16 * 1024;
const GREP_MAX_FILE_BYTES = 1024 * 1024; // skip files larger than 1 MB
const READ_MAX_LINES = 300;
const READ_MAX_BYTES = 24 * 1024;

// Directories and binary/generated extensions never worth grepping for a
// "how/why was X implemented" question. The frozen result CSVs and compiled
// PDFs under thesis-src are large and answered by wandb_query / the PDF viewer,
// not by code search.
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  '__pycache__',
  '.venv',
  'venv',
  '.mypy_cache',
  '.pytest_cache',
  '.ipynb_checkpoints',
]);
const SKIP_EXTENSIONS = new Set([
  '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.gz', '.zip', '.tar', '.7z', '.pt', '.pth', '.ckpt', '.npy', '.npz',
  '.csv', '.parquet', '.h5', '.hdf5', '.bin',
  '.xdv', '.synctex.gz', '.aux', '.bbl', '.bcf', '.fdb_latexmk', '.fls', '.out', '.toc',
  '.woff', '.woff2', '.ttf', '.otf',
]);

function toCitationPath(root: string, absolute: string): string {
  // Submodule-relative, forward-slashed — matches the GitHub blob URL the
  // frontend builds from SUBMODULE_SHA, so [code: path:lines] is clickable.
  return relative(root, absolute).split(sep).join('/');
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) {
    if (buf[i] === 0) return true; // NUL byte → treat as binary
  }
  return false;
}

function hasSkippedExtension(name: string): boolean {
  const lower = name.toLowerCase();
  for (const ext of SKIP_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

export class RepoReadTool implements Tool {
  constructor(private readonly rootDir: string) {}

  readonly definition: ToolDefinition = {
    name: 'repo_read',
    description:
      'Read a file (or a line range) from the pinned thesis-src code+TeX ' +
      'submodule. Use this to read real implementation after locating it with ' +
      'repo_grep, so answers about "how/why X was done" are grounded in actual ' +
      'code rather than guessed. Paths are relative to the submodule root ' +
      '(e.g. "src/thesis_ml/architectures/transformer_classifier/modules/ffn/__init__.py"). ' +
      'Returns numbered lines and a [code: path:start-end] anchor you must cite.',
    input_schema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Submodule-relative file path (no leading slash, no "..").',
        },
        start_line: {
          type: 'integer',
          description: 'Optional 1-indexed first line to return (inclusive).',
        },
        end_line: {
          type: 'integer',
          description: 'Optional 1-indexed last line to return (inclusive).',
        },
      },
      required: ['path'],
    },
  };

  execute(input: Record<string, unknown>): ToolResult {
    const path = input.path;
    if (typeof path !== 'string' || path.length === 0) {
      return toolError('"path" is required and must be a non-empty string.');
    }

    let abs: string;
    try {
      abs = resolveWithinRoot(this.rootDir, path);
    } catch (e) {
      if (e instanceof PathEscapeError) return toolError(e.message);
      return toolError(`could not resolve path: ${String(e)}`);
    }

    let stat;
    try {
      stat = statSync(abs);
    } catch {
      return toolError(`file not found: ${path}`);
    }
    if (stat.isDirectory()) {
      return toolError(`"${path}" is a directory; use repo_grep or read a file inside it.`);
    }

    const raw = readFileSync(abs);
    if (looksBinary(raw)) {
      return toolError(`"${path}" appears to be a binary file and cannot be read as text.`);
    }

    const root = realpathSync(this.rootDir);
    const citePath = toCitationPath(root, abs);
    const allLines = raw.toString('utf8').split(/\r?\n/);
    const total = allLines.length;

    let start = 1;
    let end = total;
    if (input.start_line !== undefined) {
      const s = Number(input.start_line);
      if (Number.isFinite(s)) start = Math.max(1, Math.floor(s));
    }
    if (input.end_line !== undefined) {
      const e = Number(input.end_line);
      if (Number.isFinite(e)) end = Math.min(total, Math.floor(e));
    }
    if (start > end) {
      return toolError(`start_line (${start}) is after end_line (${end}).`);
    }

    let truncatedNote = '';
    if (end - start + 1 > READ_MAX_LINES) {
      end = start + READ_MAX_LINES - 1;
      truncatedNote =
        `\n... (truncated to ${READ_MAX_LINES} lines; request a narrower ` +
        `start_line/end_line to see more)`;
    }

    const width = String(end).length;
    const out: string[] = [];
    let bytes = 0;
    let byteTruncated = false;
    for (let i = start; i <= end; i++) {
      const line = `${String(i).padStart(width, ' ')}  ${allLines[i - 1] ?? ''}`;
      bytes += Buffer.byteLength(line) + 1;
      if (bytes > READ_MAX_BYTES) {
        end = i - 1;
        byteTruncated = true;
        break;
      }
      out.push(line);
    }
    if (byteTruncated) {
      truncatedNote =
        `\n... (truncated at ${READ_MAX_BYTES} bytes; request a narrower range)`;
    }

    const anchor = `[code: ${citePath}:${start}-${end}]`;
    return {
      content: `${anchor}\n${out.join('\n')}${truncatedNote}`,
    };
  }
}

export class RepoGrepTool implements Tool {
  constructor(private readonly rootDir: string) {}

  readonly definition: ToolDefinition = {
    name: 'repo_grep',
    description:
      'Search the pinned thesis-src code+TeX submodule for a regular ' +
      'expression and return matching lines with their file path and line ' +
      'number. This is the entry point for code "how/why" questions: grep to ' +
      'locate, then repo_read to read the surrounding implementation. Results ' +
      `are capped (default ${GREP_DEFAULT_MATCHES} matches, raiseable to ` +
      `${GREP_MAX_MATCHES} via max_results, ${GREP_MAX_BYTES / 1024} KB) and ` +
      'binary/large data files are skipped. Each line is a [code: path:line] anchor.',
    input_schema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Regular expression (JavaScript syntax) to search for.',
        },
        path: {
          type: 'string',
          description:
            'Optional submodule-relative subdirectory or file to limit the ' +
            'search to (e.g. "src/thesis_ml/architectures").',
        },
        ignore_case: {
          type: 'boolean',
          description: 'Case-insensitive match (default false).',
        },
        fixed_string: {
          type: 'boolean',
          description: 'Treat "pattern" as a literal string, not a regex (default false).',
        },
        max_results: {
          type: 'integer',
          description: `Cap on returned matches (default ${GREP_DEFAULT_MATCHES}, hard max ${GREP_MAX_MATCHES}).`,
        },
      },
      required: ['pattern'],
    },
  };

  execute(input: Record<string, unknown>): ToolResult {
    const pattern = input.pattern;
    if (typeof pattern !== 'string' || pattern.length === 0) {
      return toolError('"pattern" is required and must be a non-empty string.');
    }

    const root = realpathSync(this.rootDir);

    let searchRoot = root;
    if (typeof input.path === 'string' && input.path.length > 0) {
      try {
        searchRoot = resolveWithinRoot(this.rootDir, input.path);
      } catch (e) {
        if (e instanceof PathEscapeError) return toolError(e.message);
        return toolError(`could not resolve path: ${String(e)}`);
      }
    }

    let regex: RegExp;
    try {
      const source = input.fixed_string === true
        ? pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        : pattern;
      regex = new RegExp(source, input.ignore_case === true ? 'i' : '');
    } catch (e) {
      return toolError(`invalid regular expression: ${String(e)}`);
    }

    const cap = Math.min(
      GREP_MAX_MATCHES,
      typeof input.max_results === 'number' && input.max_results > 0
        ? Math.floor(input.max_results)
        : GREP_DEFAULT_MATCHES,
    );

    const matches: string[] = [];
    let bytes = 0;
    let hitCap = false;
    let filesScanned = 0;

    const files = this.collectFiles(searchRoot);
    for (const abs of files) {
      if (hitCap) break;
      let buf: Buffer;
      try {
        buf = readFileSync(abs);
      } catch {
        continue;
      }
      if (looksBinary(buf)) continue;
      filesScanned++;
      const citePath = toCitationPath(root, abs);
      const lines = buf.toString('utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        regex.lastIndex = 0;
        if (!regex.test(lines[i])) continue;
        const trimmed = lines[i].length > 300 ? `${lines[i].slice(0, 300)}…` : lines[i];
        const entry = `[code: ${citePath}:${i + 1}] ${trimmed}`;
        bytes += Buffer.byteLength(entry) + 1;
        if (matches.length >= cap || bytes > GREP_MAX_BYTES) {
          hitCap = true;
          break;
        }
        matches.push(entry);
      }
    }

    if (matches.length === 0) {
      return {
        content:
          `No matches for /${pattern}/ in ${filesScanned} files under ` +
          `${toCitationPath(root, searchRoot) || '.'}.`,
      };
    }

    const header =
      `${matches.length} match(es)${hitCap ? ' (capped; narrow the pattern or raise max_results)' : ''} ` +
      `for /${pattern}/:`;
    return { content: `${header}\n${matches.join('\n')}` };
  }

  /** Depth-first file list under `dir`, applying skip rules. */
  private collectFiles(dir: string): string[] {
    const out: string[] = [];
    let stat;
    try {
      stat = statSync(dir);
    } catch {
      return out;
    }
    if (stat.isFile()) {
      if (!hasSkippedExtension(dir) && stat.size <= GREP_MAX_FILE_BYTES) out.push(dir);
      return out;
    }

    const stack: string[] = [dir];
    while (stack.length > 0) {
      const current = stack.pop() as string;
      let entries;
      try {
        entries = readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const ent of entries) {
        if (ent.isSymbolicLink()) continue; // never follow symlinks out of the root
        const full = join(current, ent.name);
        if (ent.isDirectory()) {
          if (!SKIP_DIRS.has(ent.name)) stack.push(full);
          continue;
        }
        if (!ent.isFile()) continue;
        if (hasSkippedExtension(ent.name)) continue;
        let size = 0;
        try {
          size = statSync(full).size;
        } catch {
          continue;
        }
        if (size > GREP_MAX_FILE_BYTES) continue;
        out.push(full);
      }
    }
    out.sort();
    return out;
  }
}
