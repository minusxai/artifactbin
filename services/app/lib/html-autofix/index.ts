/**
 * THE ONE AUTOFIX PASS for Artifactbin HTML pages: every entry point (publish, local serve, the autofix script, the
 * server's canonical path) runs these rules, so a platform-owned piece behaves the same whether the author wrote it,
 * wrote it wrong, or left it out. Pure: source in, source out, with source-offset edits (lib/html-page/html-source) so
 * author bytes outside a fix never change and the same input always yields byte-identical output.
 *
 *  FIXED   core-script  a hand-written core script misplaced, duplicated, async/defer/typed → exactly what the server expects
 *          charset      missing <meta charset> → <meta charset="utf-8"> first in <head>
 *          viewport     missing viewport meta → width=device-width, initial-scale=1
 *          design-system-meta  (D2, OFF: DESIGN_SYSTEM_META) design selection moved from <html> attributes to a head meta
 *  REFUSED script-syntax        an inline script or JSON block that does not parse, at its HTML-file line
 *          duplicate-data-af-id two elements with one identity (the server refuses these too)
 *          duplicate-id         two elements with one HTML id
 *          missing-asset        a relative local reference with no file behind it (checked only when `exists` is given)
 *
 * IDs are never assigned or renumbered here: the server's identity ledger owns them (lib/html-page canonicalizeHtmlPage).
 */
import {parse as parseJs} from 'acorn';
import {initSync,parse as parseImports} from 'es-module-lexer';
// Explicit .ts specifiers: the skill scripts load this module directly under Node in a source checkout (preview-html.mjs).
import {sha256Hex} from '@artifactbin/utils/sha256';
import {applyEdits,atHeadStart,attribute,parseSource,type Edit,type Element} from '../html-page/html-source.ts';
import {repairCoreScript} from '../html-page/index.ts';
initSync();

/**
 * D2 is prepared but disabled: design-system CSS selects `:root[data-af-design-system="NAME"]`, so moving the value
 * off <html> would unstyle pages until the platform sets that attribute from the meta. Flip only with that change.
 */
const DESIGN_SYSTEM_META = false;

type AutofixRule = 'core-script' | 'charset' | 'viewport' | 'design-system-meta';
type AutofixProblemRule = 'script-syntax' | 'duplicate-data-af-id' | 'duplicate-id' | 'missing-asset' | 'pwa-metadata';
interface AutofixLine { line: number; text: string }
interface AutofixFix { rule: AutofixRule; reason: string; before: AutofixLine[]; after: AutofixLine[] }
interface AutofixProblem { rule: AutofixProblemRule; line: number; column: number; snippet: string; message: string }
export interface AutofixOptions {
  /** Whether a local reference exists, given its path relative to the HTML file (normalized, no query/hash). */
  exists?: (relativePath: string) => boolean;
  rules?: { designSystemMeta?: boolean };
}
/** `routine` names platform-owned pieces added because they were missing (not author mistakes). */
export interface AutofixResult { html: string; changed: boolean; fixes: AutofixFix[]; problems: AutofixProblem[]; routine: string[] }

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
const DESIGN_META = (name: string) => `<meta name="artifactbin:design-system" content="${name.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}">`;

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

  // 3. D2 (disabled by default): design selection as head metadata rather than <html> attributes.
  if (options.rules?.designSystemMeta ?? DESIGN_SYSTEM_META) {
    document = parseSource(html);
    const root = document.html;
    const dark = root ? root.sourceCodeLocation?.attrs?.['data-af-dark'] : undefined;
    const design = root ? root.sourceCodeLocation?.attrs?.['data-af-design-system'] : undefined;
    if (root && (dark || design)) {
      const name = attribute(root, 'data-af-design-system');
      const hasMeta = document.elements.some((el) => el.tagName === 'meta' && attribute(el, 'name') === 'artifactbin:design-system');
      const before = startTag(html, root);
      const edits: Edit[] = [dark, design].filter((at): at is NonNullable<typeof at> => !!at).map((at) => {
        let start = at.startOffset; while (start > 0 && /\s/.test(html[start - 1]!)) start--;
        return { start, end: at.endOffset, text: '' };
      });
      const inserted = name && !hasMeta ? [DESIGN_META(name)] : [];
      if (inserted.length) edits.push(atHeadStart(document, inserted));
      html = applyEdits(html, edits);
      pending.push({ rule: 'design-system-meta', reason: 'design selection belongs in head metadata', before: [{ line: lineOf(input, parseSource(input).html ?? root), text: before }], inserted: [...inserted, startTag(html, parseSource(html).html!)] });
    }
  }

  for (const fix of pending) fixes.push({ rule: fix.rule, reason: fix.reason, before: fix.before, after: fix.inserted.filter(Boolean).map((text) => placed(html, text)) });
  return { html, changed: html !== input, fixes, problems: findProblems(html, options), routine };
}

const JS_TYPES = new Set(['', 'text/javascript', 'application/javascript', 'module', 'text/ecmascript', 'application/ecmascript']);
const JSON_TYPES = new Set(['application/json', 'importmap', 'application/ld+json', 'speculationrules']);

/** Refusals only: nothing here edits the source. */
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

  if (options.exists) {
    for (const ref of localReferences(document.elements, document.templateElements)) {
      if (!options.exists(ref.path)) problems.push({ rule: 'missing-asset', line: lineOf(html, ref.element), column: ref.element.sourceCodeLocation?.startCol ?? 1, snippet: clip(startTag(html, ref.element)), message: `local file not found: ${ref.value}` });
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
/** Relative project references a published page loads: element sources and literal module imports. */
export function localReferences(elements: readonly Element[], templateElements: readonly Element[] = []): Array<{ element: Element; value: string; path: string }> {
  const found: Array<{ element: Element; value: string; path: string }> = [];
  const add = (element: Element, value: string) => {
    value = value.trim();
    if (!value || REMOTE.test(value)) return;
    let decoded: string; try { decoded = decodeURIComponent(value.split(/[?#]/)[0]!); } catch { decoded = value; }
    const parts: string[] = [];
    for (const part of decoded.split('/')) { if (part === '' || part === '.') continue; if (part === '..') parts.pop(); else parts.push(part); }
    if (parts.length) found.push({ element, value, path: parts.join('/') });
  };
  for (const element of [...elements, ...templateElements]) {
    const tag = element.tagName;
    if (['img', 'script', 'source', 'video', 'audio', 'iframe', 'embed', 'track', 'input'].includes(tag)) { const src = attribute(element, 'src'); if (src !== null) add(element, src); }
    if (tag === 'video') { const poster = attribute(element, 'poster'); if (poster !== null) add(element, poster); }
    if (tag === 'object') { const data = attribute(element, 'data'); if (data !== null) add(element, data); }
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
export function formatAutofixReport(result: Pick<AutofixResult, 'fixes' | 'problems'>, options: AutofixReportOptions = {}): string {
  const { fixes, problems } = result, limit = options.limit ?? 8, file = options.file ?? 'page';
  const lines: string[] = [];
  if (!fixes.length && !problems.length) lines.push('autofix: clean');
  else {
    const counts = [fixes.length ? `${fixes.length} ${options.dryRun ? 'to fix' : 'fixed'}` : '', problems.length ? `${problems.length} problem${problems.length === 1 ? '' : 's'} to fix by hand` : ''].filter(Boolean).join(', ');
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
  const hidden = fixes.length + problems.length - Math.min(shown, fixes.length + problems.length);
  if (hidden > 0) lines.push(`  … and ${hidden} more (full detail: --json)`);
  if (options.routine?.length) lines.push(`  routine: ${options.routine.join(', ')}`);
  return lines.join('\n') + '\n';
}
