/**
 * THE ONE AUTOFIX PASS for Artifactbin HTML pages: the skill's entry points (publish.mjs, serve.mjs / the local preview,
 * autofix.mjs, check.mjs's findings) run these rules, so a platform-owned piece behaves the same whether the author
 * wrote it, wrote it wrong, or left it out. The server does not run this pass; its canonicalizeHtmlPage (lib/html-page)
 * applies the same core-script and design-selection rules itself, so pages published through the HTTP API end up the
 * same. Pure: source in, source out, with source-offset edits (lib/html-page/html-source) so author bytes outside a fix
 * never change and the same input always yields byte-identical output.
 *
 *  FIXED   core-script  a hand-written core script misplaced, duplicated, async/defer/typed → exactly what the server expects
 *          charset      missing <meta charset> → <meta charset="utf-8"> first in <head>
 *          viewport     missing viewport meta → width=device-width, initial-scale=1
 *          design-system-meta  (D2) data-af-design-system / data-af-dark on <html> → the artifactbin:design-system meta
 *          design-system-link  a copied <link data-af="design-system"> → removed; the platform stylesheet carries every system
 *          duplicate-data-af-id a later static element repeating an identity → its data-af-id dropped, so the server mints a new one
 *  ROUTINE hand-written ids     with `newPage` (a new page): every static data-af-id dropped; the platform assigns them
 *  REFUSED script-syntax        an inline script or JSON block that does not parse, at its HTML-file line
 *          duplicate-data-af-id a repeated identity inside a <template> (copies would collide; nothing to renumber)
 *          missing-asset        a relative local reference or link with no file behind it (checked only when `exists` is given)
 *  WARNED  duplicate-id         two elements with one HTML id
 *          comment-view         a state block's data-af-comment-fields/-exclude/-version the runtime would refuse (no view saved)
 *          state-version        a state block's data-af-state-version the runtime would ignore (saved state never resets)
 *          pwa-metadata         an install setting publish would silently ignore
 *          unlinked-file        an inline script naming a project file other than in a literal fetch, which publish does not find
 *
 * IDs are never assigned here: the server's identity ledger owns them (lib/html-page canonicalizeHtmlPage); dropping
 * one only lets the server mint it.
 */
import {parse as parseJs} from 'acorn';
import {initSync,parse as parseImports} from 'es-module-lexer';
// Explicit .ts specifiers: the skill scripts load this module directly under Node in a source checkout (preview-html.mjs).
import {sha256Hex} from '@artifactbin/utils/sha256';
import {applyEdits,atHeadStart,attribute,parseSource,type Element} from '../html-page/html-source.ts';
import {repairCoreScript} from '../html-page/index.ts';
import {normalizeDesignSelection} from '../html-page/design-system.ts';
import {parseCommentViewFieldList} from '../../../contracts/src/comment-view-state.ts';
import {STATE_VERSION_ATTRIBUTE,isStateVersion} from '../../../contracts/src/state-version.ts';
import {scriptFetchPaths} from './script-fetches.ts';
export {scriptFetchPaths} from './script-fetches.ts';
initSync();

type AutofixRule = 'core-script' | 'charset' | 'viewport' | 'design-system-meta' | 'design-system-link' | 'duplicate-data-af-id';
type AutofixProblemRule = 'script-syntax' | 'duplicate-data-af-id' | 'duplicate-id' | 'missing-asset' | 'pwa-metadata' | 'comment-view' | 'state-version' | 'unlinked-file';
interface AutofixLine { line: number; text: string }
interface AutofixFix { rule: AutofixRule; reason: string; before: AutofixLine[]; after: AutofixLine[] }
interface AutofixProblem { rule: AutofixProblemRule; line: number; column: number; snippet: string; message: string }
export interface AutofixOptions {
  /** Whether a local reference exists, given its path relative to the HTML file (normalized, no query/hash). */
  exists?: (relativePath: string) => boolean;
  /** A page with no published identity yet: hand-written static data-af-ids are dropped (the platform assigns them). */
  newPage?: boolean;
}
/** `routine` names platform-owned pieces added because they were missing (not author mistakes). */
export interface AutofixResult { html: string; changed: boolean; fixes: AutofixFix[]; problems: AutofixProblem[]; warnings: AutofixProblem[]; routine: string[] }

const lineAt = (source: string, offset: number): number => { let line = 1; for (let i = 0; i < offset && i < source.length; i++) if (source.charCodeAt(i) === 10) line++; return line; };
const columnAt = (source: string, offset: number): number => offset - source.lastIndexOf('\n', offset - 1);
const clip = (text: string, n = 100): string => { const one = text.replace(/\s+/g, ' ').trim(); return one.length > n ? one.slice(0, n) + '…' : one; };
const startTag = (source: string, element: Element): string => { const tag = element.sourceCodeLocation?.startTag; return tag ? source.slice(tag.startOffset, tag.endOffset) : `<${element.tagName}>`; };
const lineOf = (source: string, element: Element): number => element.sourceCodeLocation?.startLine ?? lineAt(source, element.sourceCodeLocation?.startOffset ?? 0);
/** Where an inserted snippet now sits in the final output. */
const placed = (output: string, text: string): AutofixLine => { const at = output.indexOf(text); return { line: at < 0 ? 0 : lineAt(output, at), text }; };

const inHead = (element: Element, head: Element | null): boolean => { for (let at = element.parentNode as unknown as Element | null; at; at = (at.parentNode as unknown as Element | null)) if (at === head) return true; return false; };

const CHARSET = '<meta charset="utf-8">';
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1">';

/** Apply every fix rule, then report every refusal against the fixed source (its lines are what the author will see). */
export function autofixHtml(input: string, options: AutofixOptions = {}): AutofixResult {
  const fixes: AutofixFix[] = [], routine: string[] = [];
  let html = input;
  const pending: Array<{ rule: AutofixRule; reason: string; before: AutofixLine[]; inserted: string[] }> = [];

  // 1. The core script, by the server's own rule (lib/html-page repairCoreScript).
  const core = repairCoreScript(html);
  if (core.changed) {
    const why = core.removed.length === 0 ? 'missing; the platform adds it'
      : core.removed.length > 1 ? 'duplicated; exactly one is allowed'
      : core.removed.some((el) => attribute(el, 'async') !== null || attribute(el, 'defer') !== null || attribute(el, 'type') !== null) ? 'async/defer/type removed; it must block'
      : 'moved to the first script in <head>';
    // A missing core is routine (the server adds it); only a hand-written one that was wrong is reported as a fix.
    if (!core.removed.length) routine.push('added core script');
    else pending.push({ rule: 'core-script', reason: why, before: core.removed.map((el) => ({ line: lineOf(html, el), text: startTag(html, el) + '</script>' })), inserted: [core.html.match(/<script src="\/af\/v1\/core\.js"[^>]*><\/script>/)?.[0] ?? ''] });
    html = core.html;
  }

  // 2. charset and viewport, first in <head>.
  let document = parseSource(html);
  const heads = document.elements.filter((el) => el.tagName === 'meta' && inHead(el, document.head));
  const hasCharset = heads.some((el) => attribute(el, 'charset') !== null || (attribute(el, 'http-equiv') ?? '').toLowerCase() === 'content-type');
  const hasViewport = heads.some((el) => (attribute(el, 'name') ?? '').toLowerCase() === 'viewport');
  const metas = [...(hasCharset ? [] : [CHARSET]), ...(hasViewport ? [] : [VIEWPORT])];
  if (metas.length) {
    html = applyEdits(html, [atHeadStart(document, metas)]);
    if (!hasCharset) pending.push({ rule: 'charset', reason: 'missing; pages are UTF-8', before: [], inserted: [CHARSET] });
    if (!hasViewport) pending.push({ rule: 'viewport', reason: 'missing; phones would render a desktop-width page', before: [], inserted: [VIEWPORT] });
  }

  // 3. D2: design selection is head metadata; the platform owns the <html> attributes and the system stylesheet.
  const design = normalizeDesignSelection(html);
  if (design.changed) {
    html = design.html;
    const root = parseSource(html).html;
    if (design.rootBefore) pending.push({ rule: 'design-system-meta', reason: 'the platform sets <html> design attributes; the page names its system in head metadata', before: [design.rootBefore], inserted: [...(design.insertedMeta ? [design.insertedMeta] : []), root ? startTag(html, root) : ''] });
    else if (design.insertedMeta) pending.push({ rule: 'design-system-meta', reason: 'the copied stylesheet named the system; head metadata names it now', before: [], inserted: [design.insertedMeta] });
    if (design.removedLinks.length) pending.push({ rule: 'design-system-link', reason: 'the platform adds the design-system stylesheet and fonts; no copy is uploaded', before: design.removedLinks, inserted: [] });
  }

  // 4. Static identities: hand-written ones on a new page, and a later copy of a repeated one, are dropped for the server to mint.
  const ids = parseSource(html), seenIds = new Set<string>(), drops: Element[] = [];
  let handWritten = 0;
  for (const element of ids.elements) {
    const id = attribute(element, 'data-af-id');
    if (id === null) continue;
    if (options.newPage) { handWritten++; drops.push(element); continue; }
    if (!seenIds.has(id)) { seenIds.add(id); continue; }
    drops.push(element);
    pending.push({ rule: 'duplicate-data-af-id', reason: `"${id}" repeats an earlier element's id; this copy gets a new one from the platform`, before: [{ line: lineOf(html, element), text: startTag(html, element) }], inserted: [] });
  }
  if (drops.length) html = applyEdits(html, drops.map((element) => dropAttribute(html, element, 'data-af-id')));
  if (handWritten) routine.push(`dropped ${handWritten} hand-written data-af-id (the platform assigns them)`);

  for (const fix of pending) fixes.push({ rule: fix.rule, reason: fix.reason, before: fix.before, after: fix.inserted.filter(Boolean).map((text) => placed(html, text)) });
  const found = findProblems(html, options), warned = new Set<AutofixProblemRule>(['duplicate-id', 'pwa-metadata', 'comment-view', 'state-version', 'unlinked-file']);
  return { html, changed: html !== input, fixes, problems: found.filter((problem) => !warned.has(problem.rule)), warnings: found.filter((problem) => warned.has(problem.rule)), routine };
}

/** Remove one attribute with the whitespace before it. */
function dropAttribute(source: string, element: Element, name: string) {
  const at = element.sourceCodeLocation!.attrs![name]!;
  let start = at.startOffset;
  while (start > 0 && /\s/.test(source[start - 1]!)) start--;
  return { start, end: at.endOffset, text: '' };
}

const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript', 'application/ecmascript']);
const JSON_TYPES = new Set(['application/json', 'importmap', 'application/ld+json', 'speculationrules']);

/** Refusals and warnings (autofixHtml splits them): nothing here edits the source. */
function findProblems(html: string, options: AutofixOptions = {}): AutofixProblem[] {
  const document = parseSource(html);
  const all = [...document.elements, ...document.templateElements];
  const problems: AutofixProblem[] = [];

  for (const script of all) {
    if (script.tagName !== 'script' || attribute(script, 'src') !== null) continue;
    const location = script.sourceCodeLocation;
    if (!location?.startTag || !location.endTag) continue;
    const type = (attribute(script, 'type') ?? '').trim().toLowerCase();
    const start = location.startTag.endOffset, code = html.slice(start, location.endTag.startOffset);
    if (!code.trim()) continue;
    if (JS_TYPES.has(type)) {
      try { parseJs(code, { ecmaVersion: 'latest', sourceType: type === 'module' ? 'module' : 'script', allowHashBang: true }); }
      catch (error) {
        const pos = typeof (error as { pos?: unknown }).pos === 'number' ? (error as { pos: number }).pos : 0;
        const offset = start + pos, lineStart = html.lastIndexOf('\n', offset - 1) + 1, lineEnd = html.indexOf('\n', offset);
        problems.push({ rule: 'script-syntax', line: lineAt(html, offset), column: columnAt(html, offset), snippet: clip(html.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)), message: `${type === 'module' ? 'module' : 'script'} syntax error: ${String((error as Error).message).replace(/\s*\(\d+:\d+\)$/, '')}` });
      }
    } else if (JSON_TYPES.has(type)) {
      try { JSON.parse(code); }
      catch (error) { problems.push({ rule: 'script-syntax', line: lineOf(html, script), column: 1, snippet: clip(startTag(html, script)), message: `${type} block is not valid JSON: ${(error as Error).message}` }); }
    }
  }

  const duplicates = (rule: 'duplicate-data-af-id' | 'duplicate-id', name: string, elements: readonly Element[]) => {
    const first = new Map<string, Element>();
    for (const element of elements) {
      const value = attribute(element, name);
      if (value === null || value === '') continue;
      const seen = first.get(value);
      if (!seen) { first.set(value, element); continue; }
      problems.push({ rule, line: lineOf(html, element), column: element.sourceCodeLocation?.startCol ?? 1, snippet: clip(startTag(html, element)), message: `duplicate ${name} "${value}" (first at line ${lineOf(html, seen)})` });
    }
  };
  duplicates('duplicate-data-af-id', 'data-af-id', all);
  // Template contents are cloned many times; their ids only collide once stamped, which is the script's concern.
  duplicates('duplicate-id', 'id', document.elements);

  // Install metadata is read leniently at publish time (an invalid value is silently ignored), so say what is wrong here.
  for (const element of document.elements) {
    if (element.tagName !== 'meta' || element.parentNode !== document.head) continue;
    const name = attribute(element, 'name') ?? '', value = attribute(element, 'content');
    if (!name.startsWith('artifactbin:pwa-') || value === null) continue;
    const bad = pwaMetaProblem(name.slice('artifactbin:pwa-'.length), value);
    if (bad) problems.push({ rule: 'pwa-metadata', line: lineOf(html, element), column: element.sourceCodeLocation?.startCol ?? 1, snippet: clip(startTag(html, element)), message: `${name}: ${bad}; the setting is ignored` });
  }

  // Saved comment views (lib/html-runtime/comment-view): an invalid list makes every comment target-only, silently.
  for (const element of document.elements) {
    if (element.tagName !== 'script' || attribute(element, 'data-af') !== 'state') continue;
    const report = (message: string) => problems.push({ rule: 'comment-view', line: lineOf(html, element), column: element.sourceCodeLocation?.startCol ?? 1, snippet: clip(startTag(html, element)), message: `${message}; comments on this page would save no view` });
    for (const name of ['data-af-comment-fields', 'data-af-comment-exclude']) {
      const value = attribute(element, name);
      if (value === null) continue;
      const names = parseCommentViewFieldList(value);
      if (typeof names === 'string') report(`${name} ${names}: write a JSON array of unique top-level state field names, like '["draft"]'`);
      else if (name === 'data-af-comment-fields' && !names.length) report(`${name} is empty: list the fields to save, or remove it to save every field`);
    }
    const version = attribute(element, 'data-af-comment-version');
    if (version !== null && (!version || version.length > 128)) report('data-af-comment-version must be 1-128 characters, or removed');
    // The page state version (lib/html-runtime/viewer-overrides): an invalid one is ignored, so no viewer's saved state resets.
    const stateVersion = attribute(element, STATE_VERSION_ATTRIBUTE);
    if (stateVersion !== null && !isStateVersion(stateVersion)) problems.push({ rule: 'state-version', line: lineOf(html, element), column: element.sourceCodeLocation?.startCol ?? 1, snippet: clip(startTag(html, element)), message: `${STATE_VERSION_ATTRIBUTE} must be 1-64 letters, digits, '.', '_' or '-'; it is ignored, so changing it would not reset viewers' saved state` });
  }

  if (options.exists) {
    const references = localReferences(document.elements, document.templateElements);
    for (const ref of references) {
      const link = ref.element.tagName === 'a' || ref.element.tagName === 'area';
      if (!options.exists(ref.path)) problems.push({ rule: 'missing-asset', line: lineOf(html, ref.element), column: ref.element.sourceCodeLocation?.startCol ?? 1, snippet: clip(startTag(html, ref.element)), message: link ? `linked file not found: ${ref.value}; put it beside the page or link a full address` : `local file not found: ${ref.value}` });
    }
    // A script's own string naming a project file: publish uploads what the HTML links and what a script fetches by a
    // literal path (./script-fetches), so a name held anywhere else (a constant, d3.json) publishes nothing. A guess
    // from literals, so a warning.
    const linked = new Set(references.map((ref) => ref.path));
    for (const element of [...document.elements, ...document.templateElements]) {
      if (element.tagName !== 'script' || attribute(element, 'src') !== null) continue;
      const text = textContent(element);
      for (const fetched of scriptFetchPaths(text, attribute(element, 'type') === 'module')) { const path = projectPath(fetched); if (path) linked.add(path); }
      for (const [, , value] of text.matchAll(SCRIPT_PATH)) {
        const path = projectPath(value!);
        if (!path || linked.has(path) || !options.exists(path)) continue;
        linked.add(path);
        problems.push({ rule: 'unlinked-file', line: lineOf(html, element), column: element.sourceCodeLocation?.startCol ?? 1, snippet: clip(startTag(html, element)), message: `a script names ${value}, which publishes with the page only when a script fetches it by that literal path: fetch('${value}')` });
      }
    }
  }
  return problems.sort((a, b) => a.line - b.line || a.column - b.column);
}

/** Why an install-metadata value would be ignored, or undefined when it is valid (the same limits as htmlPwaSettings). */
function pwaMetaProblem(field: string, value: string): string | undefined {
  if (field === 'enabled') return value === 'true' || value === 'false' ? undefined : 'content must be true or false';
  if (field === 'icon') return /^ref:[a-zA-Z0-9]{6,12}$/.test(value) ? undefined : 'content must be ref:ID of a readable image artifact (6-12 letters or digits)';
  if (field === 'theme-color' || field === 'background-color') return /^#[0-9a-fA-F]{6}$/.test(value) ? undefined : 'content must be a six-digit hex color such as #234b35';
  if (field === 'name' || field === 'short-name') {
    const max = field === 'name' ? 100 : 30;
    return value.trim() && value.length <= max ? undefined : `content must be nonblank and at most ${max} characters`;
  }
  return 'unknown setting; use enabled, name, short-name, icon, theme-color or background-color';
}

const REMOTE = /^(?:[a-z][a-z\d+.-]*:|\/|#|\$|\{)/i;
/** A quoted relative file path in script text (`'./data.json'`, `"img/a.png"`): a name with an extension. */
const SCRIPT_PATH = /(["'`])((?:\.{1,2}\/)?[\w-][\w\-./%]*\.[A-Za-z0-9]{1,10})\1/g;
/** The project path a relative reference names: dot segments resolved, query and hash dropped; null when none. */
function projectPath(value: string): string | null {
  value = value.trim();
  if (!value || REMOTE.test(value)) return null;
  let decoded: string; try { decoded = decodeURIComponent(value.split(/[?#]/)[0]!); } catch { decoded = value; }
  const parts: string[] = [];
  for (const part of decoded.split('/')) { if (part === '' || part === '.') continue; if (part === '..') parts.pop(); else parts.push(part); }
  return parts.length ? parts.join('/') : null;
}
/** Relative project references a published page loads or links: element sources, links and literal module imports. */
export function localReferences(elements: readonly Element[], templateElements: readonly Element[] = []): Array<{ element: Element; value: string; path: string }> {
  const found: Array<{ element: Element; value: string; path: string }> = [];
  const add = (element: Element, value: string) => {
    value = value.trim();
    const path = projectPath(value);
    if (path) found.push({ element, value, path });
  };
  for (const element of [...elements, ...templateElements]) {
    const tag = element.tagName;
    if (['img', 'script', 'source', 'video', 'audio', 'iframe', 'embed', 'track', 'input'].includes(tag)) { const src = attribute(element, 'src'); if (src !== null) add(element, src); }
    if (tag === 'video') { const poster = attribute(element, 'poster'); if (poster !== null) add(element, poster); }
    if (tag === 'object') { const data = attribute(element, 'data'); if (data !== null) add(element, data); }
    // A link to a project file publishes that file with the page (lib/html-publication-bundle).
    if (tag === 'a' || tag === 'area') { const href = attribute(element, 'href'); if (href !== null) add(element, href); }
    if (tag === 'link' || tag === 'image' || tag === 'use') {
      const rel = (attribute(element, 'rel') ?? '').split(/\s+/);
      const href = attribute(element, 'href') ?? attribute(element, 'xlink:href');
      if (href !== null && !rel.includes('af-dataset') && !(tag === 'use' && href.startsWith('#'))) add(element, href);
    }
    const srcset = attribute(element, 'srcset');
    if (srcset) for (const candidate of srcset.split(',')) { const url = candidate.trim().split(/\s+/)[0]; if (url) add(element, url); }
    if (tag === 'script' && (attribute(element, 'type') ?? '').trim().toLowerCase() === 'module' && attribute(element, 'src') === null) {
      for (const specifier of moduleSpecifiers(textContent(element))) if (specifier.startsWith('.')) add(element, specifier);
    }
  }
  return found;
}

const textContent = (element: Element): string => element.childNodes.map((node) => ('value' in node ? String(node.value) : '')).join('');
/** Literal static and dynamic import specifiers; unparseable code yields none (the syntax rule reports it). */
function moduleSpecifiers(code: string): string[] {
  try { return parseImports(code)[0].flatMap((item) => (item.n === undefined ? [] : [item.n])); } catch { return []; }
}

/**
 * THE SCRIPT FINGERPRINT of a canonical page: a hash over every <script> element in document order — its attributes
 * except data-af-id, its code, the module specifiers it imports, and for each local script or module file the content
 * revision `revision(path)` returns. Stylesheets are deliberately absent, so a CSS-only version can be morphed in place;
 * two versions with equal fingerprints run exactly the same code. Hosted canonical sources need no `revision`: their
 * local files are already immutable dependency URLs carrying a revision.
 */
export function scriptFingerprint(html: string, revision?: (relativePath: string) => string | undefined): string {
  const document = parseSource(html);
  const parts: unknown[] = [];
  for (const script of [...document.elements, ...document.templateElements]) {
    if (script.tagName !== 'script') continue;
    const attrs = script.attrs.filter((attr) => attr.name !== 'data-af-id').map((attr) => [attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name, attr.value]).sort((a, b) => (a[0]! < b[0]! ? -1 : a[0]! > b[0]! ? 1 : 0));
    const code = textContent(script), module = (attribute(script, 'type') ?? '').trim().toLowerCase() === 'module';
    const specifiers = module ? moduleSpecifiers(code) : [];
    const locals = revision ? localReferences([script]).map((ref) => [ref.path, revision(ref.path) ?? null]) : [];
    parts.push([attrs, code, specifiers, locals]);
  }
  return sha256Hex(JSON.stringify(parts));
}

export interface AutofixReportOptions {
  /** The file reported on (its basename keeps lines short). */
  file?: string;
  /** Where the fixed source went: e.g. "also written to index.html" or "served fixed; file unchanged (run autofix.mjs to write)". */
  landed?: string;
  /** Routine canonical changes, already phrased: "added 48 data-af-id", "carried forward 46 data-af-id from v15, 3 new". */
  routine?: readonly string[];
  /** Fixes listed as "would fix" (a dry run) rather than applied. */
  dryRun?: boolean;
  /** At most this many fixes and problems are listed; the rest are counted. */
  limit?: number;
}

/** The human report every entry point prints. It always starts with `autofix:`; --json callers get the full result instead. */
export function formatAutofixReport(result: Pick<AutofixResult, 'fixes' | 'problems'> & { warnings?: AutofixProblem[] }, options: AutofixReportOptions = {}): string {
  const { fixes, problems } = result, warnings = result.warnings ?? [], limit = options.limit ?? 8, file = options.file ?? 'page';
  const lines: string[] = [];
  if (!fixes.length && !problems.length && !warnings.length) lines.push('autofix: clean');
  else {
    const counts = [fixes.length ? `${fixes.length} ${options.dryRun ? 'to fix' : 'fixed'}` : '', problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'} to fix by hand` : '', warnings.length ? `${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
    lines.push(`autofix: ${counts}${options.landed ? ` — ${options.landed}` : ''}`);
  }
  let shown = 0;
  for (const fix of fixes) {
    if (shown++ >= limit) break;
    lines.push(`  ${options.dryRun ? 'would fix' : 'fixed'} ${fix.rule}: ${fix.reason}`);
    for (const line of fix.before) lines.push(`    - ${file}:${line.line}  ${clip(line.text, 90)}`);
    for (const line of fix.after) lines.push(`    + ${file}:${line.line}  ${clip(line.text, 90)}`);
  }
  for (const problem of problems) {
    if (shown++ >= limit) break;
    lines.push(`  refused ${file}:${problem.line}:${problem.column} ${problem.message}`, `    ${problem.snippet}`);
  }
  for (const warning of warnings) {
    if (shown++ >= limit) break;
    lines.push(`  warning ${file}:${warning.line}:${warning.column} ${warning.message}`, `    ${warning.snippet}`);
  }
  const total = fixes.length + problems.length + warnings.length, hidden = total - Math.min(shown, total);
  if (hidden > 0) lines.push(`  … and ${hidden} more (full detail: --json)`);
  if (options.routine?.length) lines.push(`  routine: ${options.routine.join(', ')}`);
  return lines.join('\n') + '\n';
}
