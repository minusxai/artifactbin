/**
 * THE MARKDOWN LAYOUT AND INSTRUCTION-FILE GUARD (scripts/__tests__/markdown-policy.test.mjs runs it).
 *
 * Agents read the root AGENTS.md whole at the start of every session, then the one scoped AGENTS.md its dispatch
 * table names for the area they touch; a person running their own copy reads SETUP.md. There is no docs folder:
 * a rule lives in the card for the directory it binds, an explanation in the header comment of the code it
 * explains. That only works while the arrangement stays small, flat and true, so every rule is checked here, as
 * data, over a tree of tracked paths:
 *
 *   R1 every tracked *.md is in the allowed layout below (the root files, the scoped pairs, the author skill);
 *   R2 every AGENTS.md has a sibling CLAUDE.md that is exactly `@AGENTS.md\n`, and the reverse;
 *   R3 the root AGENTS.md stays under 8,192 bytes, a scoped one under 4,096;
 *   R4 the root's dispatch table links each scoped AGENTS.md exactly once, and no AGENTS.md that does not exist;
 *   R5 a scoped AGENTS.md never links or names another AGENTS.md (the root included): one level deep;
 *   R6 every relative markdown link in the root files and every AGENTS.md resolves to a tracked file;
 *   R7 every checkable inline code span (a repo path, an `npm run` script, a code identifier) in the root files and
 *      every AGENTS.md names something that exists. A path may be a module specifier (no extension, or a
 *      directory's index), and a slash-less `name.ext` that no tracked file has passes only as a member access
 *      (`caps.sql`) that occurs in a tracked source;
 *   R10 a `docs/<name>.md` named in a tracked source file (a comment, a string) is a tracked file, so with no docs
 *       folder no source may cite one. Tests and fixtures are not read: they name made-up docs on purpose.
 *   (R8 and R9 guarded the docs folder and went with it.)
 *
 * Pure: `files` maps every tracked path to its text (markdown and package.json; any other file may be ''), and
 * the identifiers R7 found are passed in, so a literal tree and the real repository run the same code. The test
 * finds identifiers in the real repository with one `git grep` (see `referencedIdentifiers`), and the docs that
 * sources name with another (see `docMentionsIn`).
 */

const ROOT_MARKDOWN = ['README.md', 'SETUP.md', 'SECURITY.md', 'AGENTS.md', 'CLAUDE.md'];
/** The directories that hold a scoped AGENTS.md/CLAUDE.md pair, each linked from the root's dispatch table. */
export const SCOPED_DIRS = [
  'services/app/lib/platform', 'services/app/lib/artifact-access', 'services/app/lib/html-runtime',
  'services/app/lib/html-components', 'services/app/lib/page-doors', 'services/app/lib/dataflow',
  'services/app/lib/skills', 'services/app/solid', 'services/app/server',
  'services/browser', 'scripts', 'scripts/ci',
];
/** The author skill: product content with its own guard (services/app/lib/skills/__tests__/skill-tree.test.ts). */
const SKILL_ROOT = 'services/app/skills/artifactbin/';
const ROOT_MAX_BYTES = 8192;
const SCOPED_MAX_BYTES = 4096;
export const CLAUDE_TEXT = '@AGENTS.md\n';

const dirOf = (file) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '');
const baseOf = (file) => file.slice(file.lastIndexOf('/') + 1);
const join = (...parts) => normalize(parts.filter(Boolean).join('/'));
function normalize(file) {
  const out = [];
  for (const part of file.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') { if (!out.length || out.at(-1) === '..') out.push('..'); else out.pop(); } else out.push(part);
  }
  return out.join('/');
}
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const isMarkdown = (file) => file.endsWith('.md');
const isAgents = (file) => baseOf(file) === 'AGENTS.md';
const isScopedAgents = (file) => isAgents(file) && file !== 'AGENTS.md';

/** The text with every fenced code block blanked (same length and newlines, so indices still give lines). */
function withoutFences(text) {
  const lines = text.split('\n');
  let fence = null;
  return lines.map((line) => {
    const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (open && open[1][0] === fence[0] && open[1].length >= fence.length && !line.slice(open[0].length).trim()) fence = null;
      return ' '.repeat(line.length);
    }
    if (open) { fence = open[1]; return ' '.repeat(line.length); }
    return line;
  }).join('\n');
}

/** Inline code spans outside fenced blocks, CommonMark style: a run of n backticks closes on the next run of exactly
 * n, within one paragraph. `span` is the content as rendered (newlines as spaces, one padding space stripped). */
export function codeSpans(text) {
  const source = withoutFences(text);
  const spans = [];
  const run = /`+/g;
  let match;
  while ((match = run.exec(source))) {
    const open = match[0].length, start = match.index + open;
    const close = new RegExp(`(?<!\`)\`{${open}}(?!\`)`, 'g');
    close.lastIndex = start;
    const end = close.exec(source);
    const paragraphBreak = source.slice(start, end ? end.index : undefined).search(/\n[ \t]*\n/);
    if (!end || paragraphBreak !== -1) continue;
    let span = source.slice(start, end.index).replace(/\n/g, ' ').replaceAll('\\|', '|');
    if (span.length > 2 && span.startsWith(' ') && span.endsWith(' ') && span.trim()) span = span.slice(1, -1);
    spans.push({ span, line: lineAt(source, match.index), start: match.index, end: end.index + open });
    run.lastIndex = end.index + open;
  }
  return spans;
}

/** Markdown link and image targets, and reference definitions, outside fenced blocks and code spans. */
export function markdownLinks(text) {
  let source = withoutFences(text);
  for (const { start, end } of codeSpans(text)) source = source.slice(0, start) + source.slice(start, end).replace(/[^\n]/g, ' ') + source.slice(end);
  const links = [];
  for (const match of source.matchAll(/\]\(\s*(?:<([^>\n]*)>|([^)\s]+))(?:\s+["'(][^)]*)?\s*\)/g)) links.push({ target: match[1] ?? match[2], line: lineAt(source, match.index) });
  for (const match of source.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm)) links.push({ target: match[1], line: lineAt(source, match.index) });
  return links.map((link) => ({ ...link, tableRow: /^\s*\|/.test(source.split('\n')[link.line - 1]) }));
}

/** The tracked file a relative link points at, or undefined for a URL, an anchor or a site-absolute path. */
function linkTarget(file, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#') || target.startsWith('/')) return undefined;
  const bare = target.replace(/[#?].*$/, '');
  if (!bare) return undefined;
  let decoded = bare;
  try { decoded = decodeURI(bare); } catch { /* keep the raw target */ }
  return join(dirOf(file), decoded);
}

/** Scripts from the root package.json and every workspace package.json it lists. */
function packageScripts(files) {
  const scripts = new Set();
  const parse = (file) => { try { return JSON.parse(files[file] ?? ''); } catch { return undefined; } };
  const root = parse('package.json');
  for (const pkg of [root, ...(root?.workspaces ?? []).map((workspace) => parse(`${normalize(workspace)}/package.json`))]) {
    for (const name of Object.keys(pkg?.scripts ?? {})) scripts.add(name);
  }
  return scripts;
}

/** The files R6 and R7 read: every instruction file and every root markdown file (CLAUDE.md is only an import). */
const CHECKED_FILES = (file) => isAgents(file) || ROOT_MARKDOWN.includes(file);
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
/** A whole-span identifier R7 checks: six or more characters, with an internal capital or UPPER_SNAKE. */
function spanIdentifier(span) {
  const name = span.replace(/\(\)$/, '');
  if (!IDENTIFIER.test(name) || name.length < 6) return undefined;
  return /[A-Z]/.test(name.slice(1)) || /^[A-Z][A-Z0-9]*(?:_+[A-Z0-9]+)+$/.test(name) ? name : undefined;
}

/** A member access that merely ends like a file name (`caps.sql`): it may name code instead of a file. */
const MEMBER_ACCESS = /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/;

/** Every identifier, and every member access, the R7 files name in a code span: the set to look for in the
 * tracked sources. */
export function referencedIdentifiers(files) {
  const ids = new Set();
  for (const [file, text] of Object.entries(files)) {
    if (!CHECKED_FILES(file)) continue;
    for (const { span } of codeSpans(text)) {
      const id = spanIdentifier(span);
      if (id) ids.add(id);
      else if (MEMBER_ACCESS.test(span) && FILE_EXTENSION.test(span)) ids.add(span);
    }
  }
  return ids;
}

const IDENTIFIER_SOURCE = (file) => !isMarkdown(file) && baseOf(file) !== 'package-lock.json';
/** One regular expression, valid in JavaScript and in PCRE (`git grep -P`), matching any candidate as a whole word. */
export function identifierPattern(candidates) {
  return `(?<![\\w$])(?:${[...candidates].map(escape).join('|')})(?![\\w$])`;
}

/** The candidates that occur as a whole word in a tracked non-markdown file (a literal tree's stand-in for git grep). */
export function identifiersIn(files, candidates) {
  const found = new Set();
  if (!candidates.size) return found;
  const word = new RegExp(identifierPattern(candidates), 'g');
  for (const [file, text] of Object.entries(files)) if (IDENTIFIER_SOURCE(file)) for (const [match] of text.matchAll(word)) found.add(match);
  return found;
}
/** git pathspecs for the same sources: every tracked file except markdown and package-lock.json. */
export const IDENTIFIER_PATHSPECS = ['.', ':(exclude)*.md', ':(exclude)package-lock.json'];

/** R10: a flat `docs/<name>.md` (any `../` before it dropped), not part of a longer path or a URL. */
const DOC_MENTION = /(?<![\w./-])(?:\.\.\/)*(docs\/[A-Za-z0-9_-]+\.md)/g;
const DOC_MENTION_SOURCE = (file) => IDENTIFIER_SOURCE(file) && !/(?:^|\/)__tests__\/|\.test\./.test(file) && !file.startsWith('scripts/fixtures/');
/** git pathspecs for the same sources, and the extended pattern that finds candidate lines for `docMentionsOf`. */
export const DOC_MENTION_PATHSPECS = [...IDENTIFIER_PATHSPECS, ':(exclude)*__tests__*', ':(exclude)*.test.*', ':(exclude)scripts/fixtures'];
export const DOC_MENTION_GREP = 'docs/[A-Za-z0-9_-]+\\.md';
/** The docs one line of a source file names. */
export function docMentionsOf(file, line, text) {
  return [...text.matchAll(DOC_MENTION)].map((match) => ({ file, line, doc: match[1] }));
}
/** Every doc a tracked source outside tests and fixtures names (a literal tree's stand-in for git grep). */
export function docMentionsIn(files) {
  return Object.entries(files).filter(([file]) => DOC_MENTION_SOURCE(file))
    .flatMap(([file, text]) => text.split('\n').flatMap((line, i) => docMentionsOf(file, i + 1, line)));
}

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The `npm run` script a span names, or undefined. Flags (`-w <workspace>`, `--`) and their values are skipped. */
function npmScript(span) {
  const words = span.trim().split(/\s+/);
  if (words[0] !== 'npm' || words[1] !== 'run') return undefined;
  for (let i = 2; i < words.length; i++) {
    if (words[i] === '--') return undefined;
    if (['-w', '--workspace'].includes(words[i])) { i++; continue; }
    if (words[i].startsWith('-')) continue;
    return words[i];
  }
  return undefined;
}

const NOT_A_PATH = /^(?:\/|~|@|node_modules\/|tmp\/|evals\/|dist\/|\.agent\/)/;
const FILE_EXTENSION = /\.(?:ts|tsx|mjs|js|json|md|yml|sql|css|html)$/;
/** The path a span may name, before classification: line suffix and trailing slash stripped. */
function pathLike(span) {
  if (/\s/.test(span) || /<.*>/.test(span) || span.includes('://') || NOT_A_PATH.test(span)) return undefined;
  const bare = span.replace(/:\d+(?:[-:]\d+)?$/, '').replace(/\/+$/, '');
  return bare || undefined;
}
/** `a/{b,c}/d` → `a/b/d`, `a/c/d`. */
function expandBraces(value) {
  const match = /\{([^{}]*)\}/.exec(value);
  if (!match) return [value];
  return match[1].split(',').flatMap((choice) => expandBraces(value.slice(0, match.index) + choice + value.slice(match.index + match[0].length)));
}
const globRegExp = (value) => new RegExp(`^${value.split('**').map((part) => part.split('*').map(escape).join('[^/]*')).join('.*')}$`);
/** A module specifier names a file without its extension, or a directory by its index. */
const MODULE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.mjs', '.js', '.json', '/index.ts', '/index.tsx', '/index.mjs', '/index.js'];

function makeIndex(paths) {
  const all = new Set(paths);
  const basenames = new Set();
  for (const file of paths) {
    basenames.add(baseOf(file));
    for (let dir = dirOf(file); dir && !all.has(dir); dir = dirOf(dir)) all.add(dir);
  }
  const list = [...all];
  const exists = (value) => {
    if (!value.includes('*')) return MODULE_SUFFIXES.some((suffix) => all.has(value + suffix));
    const pattern = globRegExp(value);
    return list.some((entry) => pattern.test(entry));
  };
  const basenameExists = (value) => {
    if (!value.includes('*')) return basenames.has(value);
    const pattern = globRegExp(value);
    return [...basenames].some((name) => pattern.test(name));
  };
  return { exists, basenameExists };
}

/** R7 for one span: a problem string, or undefined when the span is fine or is not a checked kind. */
function spanProblem(span, file, { index, scripts, identifiers }) {
  const script = npmScript(span);
  if (script !== undefined) return scripts.has(script) ? undefined : `no package.json defines the script "${script}"`;
  if (/^npm run\b/.test(span.trim())) return undefined;
  const bare = pathLike(span);
  if (bare && (bare.includes('/') || FILE_EXTENSION.test(bare))) {
    const expansions = expandBraces(bare);
    if (!bare.includes('/')) {
      if (expansions.every((name) => index.basenameExists(name))) return undefined;
      return MEMBER_ACCESS.test(bare) && identifiers.has(bare) ? undefined : 'no tracked file has this name';
    }
    const bases = ['', dirOf(file), 'services/app'];
    const rooted = expansions.map((value) => bases.filter((base) => index.exists(join(base, value.split('/')[0]))));
    if (rooted.every((found) => !found.length)) return undefined;
    const missing = expansions.filter((value, i) => !rooted[i].some((base) => index.exists(join(base, value))));
    return missing.length ? `names no tracked file or directory (${missing.join(', ')})` : undefined;
  }
  const id = spanIdentifier(span);
  if (id && !identifiers.has(id)) return 'this identifier occurs in no tracked source file';
  return undefined;
}

/**
 * Every problem in the tree, one line each: `R<n> <file>[:<line>]: <what is wrong>`, in rule order.
 * @param {Record<string, string>} files every tracked path → its text (markdown and package.json at least)
 * @param {Set<string>} identifiers the R7 identifiers that occur in a tracked non-markdown file
 * @param {{file: string, line: number, doc: string}[]} docMentions the docs that tracked sources name (R10)
 */
export function validateMarkdownTree(files, identifiers, docMentions = []) {
  const paths = Object.keys(files).sort();
  const tracked = new Set(paths);
  const problems = [];
  const report = (rule, where, message) => problems.push(`${rule} ${where}: ${message}`);
  const markdown = paths.filter(isMarkdown);
  const agents = markdown.filter(isAgents);
  const scoped = agents.filter(isScopedAgents);
  const bytes = (file) => new TextEncoder().encode(files[file]).length;

  // R1 allowlist.
  const allowed = new Set([...ROOT_MARKDOWN, ...SCOPED_DIRS.flatMap((dir) => [`${dir}/AGENTS.md`, `${dir}/CLAUDE.md`])]);
  for (const file of markdown) {
    if (!allowed.has(file) && !file.startsWith(SKILL_ROOT)) report('R1', file, 'markdown is not allowed here: a rule goes in the scoped AGENTS.md for its directory, setup in SETUP.md, an explanation in the header comment of the code it explains; history is deleted');
  }

  // R2 pairs.
  for (const file of agents) {
    const claude = join(dirOf(file), 'CLAUDE.md');
    if (!tracked.has(claude)) report('R2', file, `has no sibling ${claude}`);
  }
  for (const file of markdown.filter((name) => baseOf(name) === 'CLAUDE.md')) {
    if (!tracked.has(join(dirOf(file), 'AGENTS.md'))) report('R2', file, 'has no sibling AGENTS.md');
    if (files[file] !== CLAUDE_TEXT) report('R2', file, `must be exactly ${JSON.stringify(CLAUDE_TEXT)}`);
  }

  // R3 size.
  if (tracked.has('AGENTS.md') && bytes('AGENTS.md') >= ROOT_MAX_BYTES) report('R3', 'AGENTS.md', `${bytes('AGENTS.md')} bytes; the root must stay under ${ROOT_MAX_BYTES}`);
  for (const file of scoped) if (bytes(file) >= SCOPED_MAX_BYTES) report('R3', file, `${bytes(file)} bytes; a scoped file must stay under ${SCOPED_MAX_BYTES}`);

  // R4 dispatch.
  if (!tracked.has('AGENTS.md')) report('R4', 'AGENTS.md', 'the root instruction file is missing');
  else {
    const links = markdownLinks(files['AGENTS.md']).map((link) => ({ ...link, to: linkTarget('AGENTS.md', link.target) })).filter((link) => link.to && isAgents(link.to));
    for (const dir of SCOPED_DIRS) {
      const to = `${dir}/AGENTS.md`;
      const found = links.filter((link) => link.to === to);
      if (!found.length) report('R4', 'AGENTS.md', `the dispatch table does not link ${to}`);
      else if (found.length > 1) report('R4', 'AGENTS.md', `links ${to} ${found.length} times (lines ${found.map((link) => link.line).join(', ')}); link it once, from the dispatch table`);
      else if (!found[0].tableRow) report('R4', `AGENTS.md:${found[0].line}`, `links ${to} outside the dispatch table`);
    }
    for (const link of links) if (!tracked.has(link.to)) report('R4', `AGENTS.md:${link.line}`, `links ${link.to}, which does not exist`);
  }

  // R5 flat.
  for (const file of scoped) {
    files[file].split('\n').forEach((line, i) => {
      if (line.includes('AGENTS.md')) report('R5', `${file}:${i + 1}`, 'a scoped file must not link or name an AGENTS.md: the root dispatches, one level deep');
    });
  }

  // R6 links.
  const linkFiles = markdown.filter(CHECKED_FILES);
  for (const file of linkFiles) {
    for (const link of markdownLinks(files[file])) {
      const to = linkTarget(file, link.target);
      if (to !== undefined && !tracked.has(to)) report('R6', `${file}:${link.line}`, `link ${link.target} resolves to ${to || '.'}, which is not a tracked file`);
    }
  }

  // R7 references.
  const context = { index: makeIndex(paths), scripts: packageScripts(files), identifiers };
  for (const file of markdown.filter(CHECKED_FILES)) {
    for (const { span, line } of codeSpans(files[file])) {
      const problem = spanProblem(span, file, context);
      if (problem) report('R7', `${file}:${line}`, `\`${span}\`: ${problem}`);
    }
  }

  // R10 sources name real docs.
  for (const { file, line, doc } of docMentions) {
    if (!tracked.has(doc)) report('R10', `${file}:${line}`, `names ${doc}, which is not a tracked file: name the card, module or SETUP.md section that holds it now, or drop the reference`);
  }
  return problems;
}
