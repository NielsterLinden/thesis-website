import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export class PathEscapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathEscapeError';
  }
}

/**
 * Resolve a caller-supplied, submodule-relative path to an absolute path that
 * is provably inside `rootDir`, rejecting any escape — `..` traversal, an
 * absolute path, or a symlink that points outside the root. This is the
 * load-bearing guard for repo_grep / repo_read (Initial_plan.md §5.3, §14):
 * the tools must not be able to read outside ./thesis-src.
 *
 * Symlink handling: we `realpath` both the root and the target so a symlink
 * inside the root that points outside it resolves to its real location and
 * then fails the containment check. If the target does not exist yet we fall
 * back to the lexical resolution (which still collapses `..`), so traversal is
 * blocked even for non-existent paths and the caller gets a clean ENOENT.
 */
export function resolveWithinRoot(rootDir: string, userPath: string): string {
  if (typeof userPath !== 'string' || userPath.length === 0) {
    throw new PathEscapeError('path must be a non-empty string');
  }
  if (isAbsolute(userPath)) {
    throw new PathEscapeError(`absolute paths are not allowed: ${userPath}`);
  }

  const root = realpathSync(rootDir);
  const candidate = resolve(root, userPath);

  let real: string;
  try {
    real = realpathSync(candidate);
  } catch {
    real = candidate; // does not exist; lexical form already collapsed `..`
  }

  const rel = relative(root, real);
  if (rel !== '' && (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))) {
    throw new PathEscapeError(`path escapes the thesis-src root: ${userPath}`);
  }
  return real;
}
