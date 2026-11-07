/**
 * Internal: a git repository as the three tables examples/codebase-report.html reads. commits:
 * one row per commit (no merges) since a date, with its main area (where most lines changed).
 * files: one row per tracked text file, its size now and its history in that window. imports:
 * file-to-file imports that cross areas (JS/TS relative, tsconfig paths and workspace packages;
 * Python modules). Areas are the top directories, the largest split while it holds over a fifth
 * of the files. Lockfiles are left out. Every table keeps at most 10,000 rows (a dataset's cap)
 * and says what it cut.
 * Used by: new-codebase-report.mjs, codebase-toolbox.test.ts.
 */
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';

export const MAX_ROWS = 10000;
const ROOT = '(root)';
const LANGUAGES = {ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript', jsx: 'JavaScript', py: 'Python',
  go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', rb: 'Ruby', php: 'PHP', cs: 'C#', c: 'C',
  h: 'C', cpp: 'C++', cc: 'C++', swift: 'Swift', sh: 'Shell', sql: 'SQL', css: 'CSS',
  scss: 'CSS', html: 'HTML', vue: 'Vue', svelte: 'Svelte', md: 'Markdown', mdx: 'Markdown',
  json: 'JSON', yml: 'YAML', yaml: 'YAML', toml: 'TOML'};
const RESOLVE = ['', '.ts', '.tsx', '.js', '.mjs', '.jsx', '.cjs', '.mts', '/index.ts',
  '/index.tsx', '/index.js', '/index.mjs', '.py', '/__init__.py'];
const JS_IMPORT = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g;
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|[\w.-]+\.lockb?|go\.sum)$/;
const PY_IMPORT = /^[ \t]*(?:from[ \t]+(\.*[\w.]*)[ \t]+import\b|import[ \t]+([\w.]+))/gm;

const git = (repo, args) => execFileSync('git', ['-c', 'core.quotepath=false', '-C', repo,
  ...args], {encoding: 'utf8', maxBuffer: 1 << 30});
const cell = value => {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const lineCount = bytes => {
  let n = bytes.length && bytes.at(-1) !== 10 ? 1 : 0;
  for (let at = bytes.indexOf(10); at >= 0; at = bytes.indexOf(10, at + 1)) n++;
  return n;
};
/** Rows of one shape as CSV text: a header line, then one line per row ('' for none). */
export const toCsv = rows => !rows.length ? '' : [Object.keys(rows[0]).join(','),
  ...rows.map(row => Object.values(row).map(cell).join(','))].join('\n') + '\n';

/** The areas of these paths: top directories; while the largest holds over a fifth of the paths,
 * its largest subdirectories become areas (at most `max` in all) and the rest stay in it. */
export function areasOf(paths, max = 20) {
  const group = (prefix, list) => {
    const out = new Map();
    for (const file of list) {
      const rest = prefix ? file.slice(prefix.length + 1) : file, cut = rest.indexOf('/');
      const key = cut < 0 ? prefix || ROOT : (prefix ? prefix + '/' : '') + rest.slice(0, cut);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(file);
    }
    return out;
  };
  const areas = group('', paths), done = new Set([ROOT]);
  for (;;) {
    const [area, list] = [...areas].filter(([name]) => !done.has(name))
      .sort((a, b) => b[1].length - a[1].length)[0] ?? [];
    if (!area || list.length * 5 < paths.length) break;
    done.add(area);
    const children = [...group(area, list)].filter(([name]) => name !== area)
      .sort((a, b) => b[1].length - a[1].length);
    const all = children.reduce((n, [, files]) => n + files.length, 0) === list.length;
    const keep = children.slice(0, Math.min(children.length, max - areas.size + 1));
    if (keep.length < children.length || !all) keep.splice(Math.max(0, max - areas.size));
    if (!keep.length) continue;
    const moved = new Set(keep.flatMap(([, files]) => files)), rest = list.filter(file =>
      !moved.has(file));
    if (rest.length) areas.set(area, rest); else areas.delete(area);
    for (const [name, files] of keep) areas.set(name, files);
  }
  return [...areas.keys()].sort();
}
/** A path's area: the longest area it lies in, else its first directory (a deleted one). */
function areaFinder(areas) {
  const longest = [...areas].sort((a, b) => b.length - a.length), seen = new Map();
  return file => {
    if (!seen.has(file)) seen.set(file, longest.find(area => file.startsWith(area + '/')) ??
      (file.includes('/') ? file.slice(0, file.indexOf('/')) : ROOT));
    return seen.get(file);
  };
}
/** How an import names another tracked file: tsconfig paths, workspace package names. */
function resolver(repo, known) {
  const json = file => {
    try { return JSON.parse(readFileSync(path.join(repo, file), 'utf8')); } catch { return null; }
  };
  const config = json('tsconfig.json') ?? json('jsconfig.json');
  const base = config?.compilerOptions?.baseUrl ?? '.', prefixes = [];
  for (const [key, [target] = []] of Object.entries(config?.compilerOptions?.paths ?? {}))
    if (target) prefixes.push([key.replace(/\*$/, ''), path.posix.join(base,
      target.replace(/\*$/, ''))]);
  for (const file of known) if (/(^|\/)package\.json$/.test(file) && file.includes('/')) {
    const name = json(file)?.name;
    if (typeof name === 'string') prefixes.push([name, path.posix.dirname(file), file]);
  }
  const find = stem => {
    const plain = path.posix.normalize(stem).replace(/^\.\/|\/$/g, '');
    for (const start of [plain, plain.replace(/\.[cm]?jsx?$/, '')])
      for (const end of RESOLVE) if (known.has(start + end)) return start + end;
  };
  return (spec, from) => {
    const dir = path.posix.dirname(from);
    if (from.endsWith('.py')) {
      const dots = /^\.*/.exec(spec)[0].length, rest = spec.slice(dots).replace(/\./g, '/');
      return dots ? find(path.posix.join(dir, '../'.repeat(dots - 1), rest)) :
        find(rest) ?? find('src/' + rest);
    }
    if (spec.startsWith('.')) return find(path.posix.join(dir, spec));
    for (const [prefix, target, manifest] of prefixes) {
      if (spec !== prefix && !spec.startsWith(prefix.endsWith('/') ? prefix : prefix + '/'))
        continue;
      const rest = spec.slice(prefix.length);
      return find(path.posix.join(target, rest)) ?? (manifest && (find(path.posix.join(target,
        'src', rest)) ?? find(path.posix.join(target, 'src/index')) ?? manifest));
    }
  };
}
/** The commits since `since` (newest first, at most `limit`) and each file's history in them. */
function history(repo, since, areaOf, limit) {
  const log = git(repo, ['log', '--no-merges', '--no-renames', '--numstat', '--date=short',
    `--since=${since}`, '--format=%x1e%H%x09%ad%x09%aN']);
  const commits = [], touched = new Map(), blocks = log.split('\x1e').slice(1);
  for (const block of blocks.slice(0, limit)) {
    const [head, ...lines] = block.trim().split('\n'), [hash, date, author] = head.split('\t');
    const weight = new Map(), row = {commit: hash.slice(0, 10), date, author, area: ROOT,
      files: 0, added: 0, deleted: 0};
    for (const line of lines) {
      const [added, deleted, file] = line.split('\t');
      if (!file || LOCKFILE.test(file)) continue;
      const n = (Number(added) || 0) + (Number(deleted) || 0), area = areaOf(file);
      Object.assign(row, {files: row.files + 1, added: row.added + (Number(added) || 0),
        deleted: row.deleted + (Number(deleted) || 0)});
      weight.set(area, (weight.get(area) ?? 0) + n + 1);
      const seen = touched.get(file) ?? {changes: 0, churn: 0, authors: new Set(), last: date};
      seen.changes++; seen.churn += n; seen.authors.add(author); touched.set(file, seen);
    }
    row.area = [...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ROOT;
    commits.push(row);
  }
  return {commits, touched, total: blocks.length};
}
/** The repository at `repo` as three CSV texts (each at most `limit` rows), its areas, the rows
 * behind them and what was cut to fit. */
export function gatherCodebase(repo, {since = '1 year ago', areas: max = 20,
  limit = MAX_ROWS} = {}) {
  const tracked = git(repo, ['ls-files', '-s', '-z']).split('\0').filter(Boolean)
    .filter(line => /^100(644|755) /.test(line)).map(line => line.slice(line.indexOf('\t') + 1))
    .filter(file => !LOCKFILE.test(file));
  const areas = areasOf(tracked, max), areaOf = areaFinder(areas), known = new Set(tracked);
  const {commits, touched, total} = history(repo, since, areaOf, limit), code = new Map();
  const files = [];
  for (const file of tracked) {
    let bytes;
    try { bytes = readFileSync(path.join(repo, file)); } catch { continue; }
    if (bytes.subarray(0, 8000).includes(0)) continue;
    const seen = touched.get(file);
    files.push({path: file, area: areaOf(file), language: LANGUAGES[path.extname(file).slice(1)
      .toLowerCase()] ?? 'Other', lines: lineCount(bytes), changes: seen?.changes ?? 0,
    churn: seen?.churn ?? 0, authors: seen?.authors.size ?? 0, last_change: seen?.last ?? ''});
    if (/\.(?:[cm]?[jt]sx?|py)$/.test(file)) code.set(file, bytes.toString('utf8'));
  }
  files.sort((a, b) => b.changes - a.changes || b.lines - a.lines);
  const resolve = resolver(repo, known), edges = new Map();
  for (const [file, text] of code) {
    for (const match of text.matchAll(file.endsWith('.py') ? PY_IMPORT : JS_IMPORT)) {
      const target = resolve(match[1] ?? match[2], file);
      if (!target || areaOf(target) === areaOf(file)) continue;
      edges.set(file + '\n' + target, {source: file, target, source_area: areaOf(file),
        target_area: areaOf(target)});
    }
  }
  const imports = [...edges.values()], counts = {commits: total, files: files.length,
    imports: imports.length};
  const kept = {commits, files: files.slice(0, limit), imports: imports.slice(0, limit)};
  return {areas, head: git(repo, ['rev-parse', '--short', 'HEAD']).trim(), ...kept,
    truncated: Object.entries(counts).filter(([, n]) => n > limit)
      .map(([name, n]) => `${name}: kept ${limit} of ${n}`),
    // A dataset needs a row: with no import between areas, one (root) row that SQL's
    // source_area <> target_area leaves out.
    tables: {commits: toCsv(commits), files: toCsv(kept.files), imports: toCsv(imports.length ?
      kept.imports : [{source: ROOT, target: ROOT, source_area: ROOT, target_area: ROOT}])}};
}
