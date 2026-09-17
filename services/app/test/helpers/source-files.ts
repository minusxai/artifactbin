/**
 * THE ONE DIRECTORY WALKER for tests that judge source text.
 *
 * Nine guards used to carry a private `sourceFiles(dir, out)` / `walk(dir)` of their own, each with
 * a slightly different skip list, and each with its own copy of the case *"is actually looking at
 * something (the scan cannot silently find nothing)"*. Five copies of the walk, ten copies of the
 * self-check, and a drift hazard in every one: a walker that silently returns nothing makes its
 * guard pass forever.
 *
 * This module owns the walk. The non-vacuity proof belongs to the caller — but it is now ONE
 * assertion over a table of scans rather than one per file.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** `services/app`. */
export const APP_ROOT = path.resolve(import.meta.dirname, '../..');
/** The repository root. */
export const REPO_ROOT = path.resolve(APP_ROOT, '../..');

/** Directories no source scan ever wants. A caller adds to this, never replaces it. */
const ALWAYS_SKIPPED = ['node_modules', '.next', 'dist', '__tests__'];

export interface WalkOptions {
  /** Which files count as source. Default: `.ts` / `.tsx`. */
  extensions?: RegExp;
  /** Directory names to skip in addition to the always-skipped set. */
  skip?: string[];
}

/**
 * Every source file under `dir`, recursively. Dot-directories, `node_modules`, build output and
 * `__tests__` are never returned — a test that scans other tests judges itself.
 */
export function sourceFiles(dir: string, options: WalkOptions = {}): string[] {
  const extensions = options.extensions ?? /\.tsx?$/;
  const skip = new Set([...ALWAYS_SKIPPED, ...(options.skip ?? [])]);
  const out: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (extensions.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
    }
  };
  walk(dir);
  return out;
}

/**
 * The file with its COMMENTS REMOVED. Prose explaining a retirement is documentation, not a use of
 * it — every one of the folded guards drew that line, and each drew it slightly differently.
 * Handles `//`, `/* … *\/` and a continuation line of a block comment (`  * …`), plus `#` for YAML.
 */
export function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => (/^\s*[*#]/.test(line) ? '' : line.replace(/\/\/.*$/, '')))
    .join('\n');
}

/** Each line of code (comments removed) with its 1-based line number. */
export function codeLines(file: string): Array<[number, string]> {
  return codeOf(readFileSync(file, 'utf8')).split('\n').map((line, i) => [i + 1, line]);
}
