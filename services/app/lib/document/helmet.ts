/**
 * The `<Helmet>` contract — the ONE legal home for document-level concerns in
 * a markup document: `<title>`, one `<style>`, one
 * `<script>`. Everything document-level flows through here; the body stays
 * pure story vocabulary.
 *
 * This module is the single Helmet authority, used by BOTH ends (publish-time
 * validation in publishJsx, read-time extraction in the document builder) —
 * never re-implement any of it. It deliberately operates on the parsed AST,
 * not source text: `validateJsx` keeps original node spans, so publish
 * validation splits the Helmet subtree out (`splitHelmet`) and hands the BODY
 * nodes to the untouched lib/jsx security boundary — diagnostics keep exact
 * offsets into the full source, and lib/jsx never learns Helmet exists.
 *
 * Grammar (violations are publish 400s with precise spans):
 *  - at most ONE `<Helmet>` in the document, anywhere (canonicalization hoists
 *    it to first top-level node — `hoistHelmet`, a fixpoint);
 *  - no attributes on `<Helmet>`, title or style; scripts may declare only type;
 *  - children: at most one each of `<title>`, `<style>`, browser `<script>` and `<script type="server">`, plus any
 *    number of `<meta>` (unique `name`s) and of the DATA declarations
 *    `<Import>` / `<Value>` / `<Query>` / `<Mutation>` (lib/dataflow/dataflow.ts owns their shape and the
 *    `$name` reference rules; the grammar here only admits them), and at most
 *    one `<Context src="ref:<documentId>" />` companion document;
 *  - `<meta>` carries `name` + `content` and NOTHING else: `http-equiv` is a
 *    policy channel (an authored CSP would rewrite the document's own
 *    sandbox) and `charset` re-declares the encoding the builder fixes;
 *  - `<title>` holds one text (or static-string expression) child;
 *  - `<style>` / `<script>` hold exactly one template-literal child
 *    (`{`…`}`) — CSS braces and JS `<` cannot survive as bare JSX text;
 *  - script text must not contain `</script` (any case): it cannot be escaped
 *    in serialized HTML, and mutating code silently is worse than rejecting.
 *    (`</style` in style text is stripped by the document builder instead —
 *    CSS has no use for the sequence; the snapshot's styleTag precedent.)
 */
import { parseJsx, type JsxElement, type JsxNode, type ValidationError } from '@/lib/jsx';
import { ARTIFACT_REFERENCE_PATTERN } from '@artifactbin/contracts';
import { carriesRef, parseDeclaration } from '@/lib/dataflow/dataflow';
import type { Dataflow } from '@/lib/dataflow';

export const HELMET_TAG = 'Helmet';
export const CONTEXT_TAG = 'Context';

/** A `<meta name content>` pair — the only meta shape the grammar admits. */
interface HelmetMeta {
  name: string;
  content: string;
}

/** What a Helmet carries, extracted as plain strings ('' = tag absent). */
export interface HelmetContent {
  /** Optional companion document ID; a live reference, never rendered in the body. */
  context?: string;
  title: string | null;
  style: string | null;
  script: string | null;
  /** Server-only entry point; never included in reader runtime data or browser modules. */
  serverScript?: string;
  /** `<meta name content>` pairs in authored order; names are unique. */
  meta: HelmetMeta[];
  /** `<Import>` declarations in authored order (lib/dataflow/dataflow.ts). */
  imports: Dataflow['imports'];
  /** `<Value>` declarations in authored order (lib/dataflow/dataflow.ts). */
  values: Dataflow['values'];
  /** `<Query>` declarations in authored order (lib/dataflow/dataflow.ts). */
  queries: Dataflow['queries'];
  /** `<Mutation>` declarations in authored order (lib/dataflow/dataflow.ts). */
  mutations: Dataflow['mutations'];
  notifications?: Dataflow['notifications'];
}

export interface HelmetSplit {
  /** The document's Helmet element, or null. (Multiple = validation error; split returns the first.) */
  helmet: JsxElement | null;
  content: HelmetContent;
  /** The tree with every Helmet subtree removed; remaining nodes keep their original source spans. */
  body: JsxNode[];
}

export const EMPTY_HELMET_CONTENT: HelmetContent = { title: null, style: null, script: null, meta: [], imports: [], values: [], queries: [], mutations: [] };

/** The data declarations of a markup source, or null when it does not parse. */
export function declarationsOf(source: string): Dataflow | null {
  const parsed = parseJsx(source);
  return parsed.ok ? dataflowOf(splitHelmet(parsed.nodes).content) : null;
}

/** The data declarations of a split Helmet, as one `Dataflow`. */
export const dataflowOf = (content: HelmetContent): Dataflow =>
  ({ imports: content.imports, values: content.values, queries: content.queries, mutations: content.mutations, ...(content.notifications?.length ? { notifications: content.notifications } : {}) });

/** Children that may appear at most ONCE and carry a text payload. */
const SINGLETON_TAGS = ['title', 'style', 'script'] as const;
type HelmetChildTag = (typeof SINGLETON_TAGS)[number];
/** Every legal child tag (`meta` repeats, keyed by `name`). */
const CHILD_TAGS = [...SINGLETON_TAGS, 'meta'] as const;

/** The one attribute pair `<meta>` may carry — see the module doc for the denials. */
const META_ATTRS = ['name', 'content'] as const;

const isHelmet = (n: JsxNode): boolean => n.type === 'element' && n.isComponent && n.tag === HELMET_TAG;

/** Every Helmet element in the tree, in document order. */
function findHelmets(nodes: JsxNode[], out: JsxElement[] = []): JsxElement[] {
  for (const n of nodes) {
    if (n.type !== 'element') continue;
    if (isHelmet(n)) out.push(n);
    findHelmets(n.children, out);
  }
  return out;
}

/** Meaningful children of an element (whitespace-only text is authoring layout, not content). */
const contentChildren = (el: JsxElement): JsxNode[] =>
  el.children.filter((c) => !(c.type === 'text' && c.value.trim() === ''));

/** Context is one reference to a regular document, with no inline content or options. */
function contextRef(el: JsxElement): string | null {
  if (el.attributes.length !== 1 || contentChildren(el).length) return null;
  const src = el.attributes[0];
  if (src.name !== 'src' || !src.value.static || typeof src.value.json !== 'string') return null;
  return ARTIFACT_REFERENCE_PATTERN.exec(src.value.json)?.[1] ?? null;
}

/** The companion document declared by source; malformed drafts declare nothing. */
export function contextRefOf(source: string): string | null {
  const parsed = parseJsx(source);
  return parsed.ok ? splitHelmet(parsed.nodes).content.context ?? null : null;
}

/**
 * The single text payload of a Helmet child. `<title>` may hold a plain text
 * child; `<style>`/`<script>` must hold a static-string EXPRESSION (the
 * template-literal form — CSS braces and JS `<` cannot survive as bare JSX
 * text, so accepting text there would bless a shape that breaks on real
 * content). Null = the shape is wrong (caller reports it).
 */
function textPayload(el: JsxElement, allowText: boolean): string | null {
  const kids = contentChildren(el);
  if (kids.length === 0) return '';
  if (kids.length !== 1) return null;
  const kid = kids[0];
  if (kid.type === 'text') return allowText ? kid.value : null;
  if (kid.type === 'expression' && kid.value.static && typeof kid.value.json === 'string') return kid.value.json;
  return null;
}

/** Script contexts are explicit; unknown types are never interpreted as browser code. */
function scriptMode(el: JsxElement): 'server' | 'browser' | 'invalid' {
  const types = el.attributes.filter(a => a.name === 'type');
  if (!types.length) return 'browser';
  if (types.length !== 1 || !types[0].value.static) return 'invalid';
  return types[0].value.json === 'server' ? 'server' : types[0].value.json === 'module' ? 'browser' : 'invalid';
}

/** Helmet-grammar validation (see module doc). [] = valid. */
export function validateHelmet(nodes: JsxNode[]): ValidationError[] {
  const errors: ValidationError[] = [];
  const helmets = findHelmets(nodes);
  for (const extra of helmets.slice(1)) {
    errors.push({
      message: `A document may carry only one <Helmet> — another begins at offset ${helmets[0].start}.`,
      tag: HELMET_TAG, start: extra.start, end: extra.end,
    });
  }
  const helmet = helmets[0];
  if (!helmet) return errors;

  if (helmet.attributes.length > 0) {
    const a = helmet.attributes[0];
    errors.push({ message: `<Helmet> takes no attributes (got "${a.name}")`, tag: HELMET_TAG, attr: a.name, start: a.start, end: a.end });
  }

  const seen = new Set<string>();
  const seenMetaNames = new Set<string>();
  for (const child of contentChildren(helmet)) {
    if (child.type === 'element' && child.isComponent && child.tag === CONTEXT_TAG) {
      if (seen.has(CONTEXT_TAG)) errors.push({ message: '<Helmet> may carry at most one <Context>', tag: child.tag, start: child.start, end: child.end });
      seen.add(CONTEXT_TAG);
      if (!contextRef(child)) errors.push({ message: '<Context> needs only src="ref:<documentId>" and no children: <Context src="ref:abc123" />', tag: child.tag, start: child.start, end: child.end });
      continue;
    }
    // The DATA declarations (lib/dataflow/dataflow.ts owns their shape; the
    // grammar here only knows they exist and repeat). Graph-level rules —
    // duplicate names, undeclared `$refs`, cycles — involve the body and run
    // in publishJsx's always-on pass, not here.
    const declaration = child.type === 'element' ? parseDeclaration(child) : null;
    if (declaration) {
      if ('errors' in declaration) errors.push(...declaration.errors);
      continue;
    }
    if (child.type !== 'element' || !(CHILD_TAGS as readonly string[]).includes(child.tag.toLowerCase()) || child.isComponent) {
      errors.push({
        message: `<Helmet> may only contain <title>, <style>, <script>, <meta>, <Import>, <Value>, <Query>, <Mutation>, <Notify>, <Context>`,
        start: child.start, end: child.end, ...(child.type === 'element' ? { tag: child.tag } : {}),
      });
      continue;
    }
    const tag = child.tag.toLowerCase();

    if (tag === 'meta') {
      const attrs = new Map(child.attributes.map((a) => [a.name.toLowerCase(), a]));
      const stray = child.attributes.find((a) => !(META_ATTRS as readonly string[]).includes(a.name.toLowerCase()));
      if (stray) {
        errors.push({
          message: `<meta> inside <Helmet> carries name and content only (got "${stray.name}") — http-equiv and charset are the document's own to set`,
          tag, attr: stray.name, start: stray.start, end: stray.end,
        });
        continue;
      }
      const name = attrs.get('name');
      const content = attrs.get('content');
      const nameValue = name?.value.static && typeof name.value.json === 'string' ? name.value.json : null;
      const contentValue = content?.value.static && typeof content.value.json === 'string' ? content.value.json : null;
      if (!nameValue || contentValue === null) {
        errors.push({ message: '<meta> needs both name and content as string literals', tag, start: child.start, end: child.end });
        continue;
      }
      if (seenMetaNames.has(nameValue)) {
        errors.push({ message: `<Helmet> already carries a <meta name="${nameValue}">`, tag, start: child.start, end: child.end });
        continue;
      }
      if (nameValue === 'artifactbin:og-image' && !/^ref:[A-Za-z0-9_-]+$/.test(contentValue)) {
        errors.push({ message: 'artifactbin:og-image needs an uploaded image reference: ref:<imageId>', tag, start: child.start, end: child.end });
      }
      seenMetaNames.add(nameValue);
      continue;
    }

    const singleton = tag as HelmetChildTag;
    const mode = singleton === 'script' ? scriptMode(child) : null;
    if (singleton === 'script' && mode === 'invalid') {
      errors.push({ message: '<script> type must be "server" or "module" (or omitted for a browser module)', tag, start: child.start, end: child.end });
    }
    const key = singleton === 'script' && mode === 'server' ? 'server script' : singleton;
    if (seen.has(key)) {
      errors.push({ message: `<Helmet> may carry at most one ${key === 'server script' ? '<script type="server">' : `<${singleton}>`}`, tag, start: child.start, end: child.end });
      continue;
    }
    seen.add(key);
    const unexpected = child.attributes.find(a => singleton !== 'script' || a.name !== 'type');
    if (unexpected) {
      const a = unexpected;
      errors.push({ message: `<${singleton}> inside <Helmet> takes no attributes (got "${a.name}")`, tag, attr: a.name, start: a.start, end: a.end });
    }
    const text = textPayload(child, singleton === 'title');
    if (text === null) {
      errors.push({
        message: singleton === 'title'
          ? `<title> holds a single text child`
          : `<${singleton}> holds a single template-literal child: <${singleton}>{\`…\`}</${singleton}>`,
        tag, start: child.start, end: child.end,
      });
      continue;
    }
    if (singleton === 'script' && /<\/script/i.test(text)) {
      errors.push({
        message: 'script text may not contain "</script" (it cannot be escaped in serialized HTML) — split the string, e.g. "</scr" + "ipt"',
        tag, start: child.start, end: child.end,
      });
    }
  }
  return errors;
}

/** Extracted contents of a (validated) Helmet element. */
function helmetContent(helmet: JsxElement): HelmetContent {
  const content: HelmetContent = { ...EMPTY_HELMET_CONTENT, meta: [], imports: [], values: [], queries: [], mutations: [] };
  for (const child of contentChildren(helmet)) {
    if (child.type !== 'element') continue;
    if (child.isComponent) {
      if (child.tag === CONTEXT_TAG) content.context ??= contextRef(child) ?? undefined;
      const declaration = parseDeclaration(child);
      if (declaration && 'kind' in declaration) {
        if (declaration.kind === 'import') content.imports.push(declaration.decl);
        else if (declaration.kind === 'value') content.values.push(declaration.decl);
        else if (declaration.kind === 'query') content.queries.push(declaration.decl);
        else if (declaration.kind === 'mutation') content.mutations.push(declaration.decl);
        else (content.notifications ??= []).push(declaration.decl);
      }
      continue;
    }
    const tag = child.tag.toLowerCase();
    if (tag === 'script') {
      const mode = scriptMode(child);
      if (mode === 'server') content.serverScript ??= textPayload(child, false) ?? undefined;
      else if (mode === 'browser') content.script ??= textPayload(child, false);
    } else if (tag === 'title' || tag === 'style') {
      content[tag] = content[tag] ?? textPayload(child, tag === 'title');
    } else if (tag === 'meta') {
      const read = (attr: string): string | null => {
        const a = child.attributes.find((x) => x.name.toLowerCase() === attr);
        return a?.value.static && typeof a.value.json === 'string' ? a.value.json : null;
      };
      const name = read('name');
      const value = read('content');
      if (name && value !== null && !content.meta.some((m) => m.name === name)) content.meta.push({ name, content: value });
    }
  }
  return content;
}

/** The tree with every Helmet subtree removed, parents cloned immutably (spans untouched). */
function withoutHelmets(nodes: JsxNode[]): JsxNode[] {
  const out: JsxNode[] = [];
  let changed = false;
  for (const n of nodes) {
    if (n.type !== 'element') { out.push(n); continue; }
    if (isHelmet(n)) { changed = true; continue; }
    const children = withoutHelmets(n.children);
    if (children === n.children) out.push(n);
    else { changed = true; out.push({ ...n, children }); }
  }
  // Nothing removed below: the same array, so an unchanged subtree stays the same object all the way up.
  return changed ? out : nodes;
}

/**
 * Does this document declare a `<Query>` — one of the two things that make a reader's
 * interaction a SERVER round trip (a value change re-runs the queries that
 * depend on it; a document of `<Value>`s alone re-runs nothing).
 *
 * Here because `<Helmet>` is the door those declarations come through, and
 * this is the only question a caller can ask about them without a parsed tree.
 *
 * Half of the decision proxy.ts makes (`declaresLiveData`, below, is the
 * whole of it): a PRIVATE document that declares a query keeps its parent
 * page, because the page holds the session its queries need — the served
 * document's own transport is an anonymous GET of /a/<id>/query
 * (lib/islands/document-transport), which a private document answers
 * with the uniform 404. Public documents fetch for themselves and keep their
 * top-level paint.
 *
 * Parsed, never pattern-matched: `<Query` in prose is text, and only a
 * declaration inside `<Helmet>` counts. Source that does not parse declares
 * nothing (the renderer shows it as escaped text) — and this runs on every
 * read, so it never throws.
 */
export function declaresQueries(source: string | null | undefined): boolean {
  if (!source) return false;
  const parsed = parseJsx(source);
  if (!parsed.ok) return false;
  return splitHelmet(parsed.nodes).content.queries.length > 0;
}

/** Does this document declare a `<Mutation>` — a write a reader can perform. Same parsing rule as declaresQueries. */
export function declaresMutations(source: string | null | undefined): boolean {
  if (!source) return false;
  const parsed = parseJsx(source);
  if (!parsed.ok) return false;
  return splitHelmet(parsed.nodes).content.mutations.length > 0;
}

/**
 * Does a reader's interaction reach the SERVER — a query to re-run or a
 * mutation to perform? The one question proxy.ts asks: a PRIVATE document
 * that answers yes keeps its parent page, because the served document's own
 * transports are anonymous (a GET of /query, a POST to /mutate) and a private
 * document refuses both; the page holds the session and relays.
 */
export function declaresLiveData(source: string | null | undefined): boolean {
  if (!source) return false;
  const parsed = parseJsx(source);
  if (!parsed.ok) return false;
  const { content, body } = splitHelmet(parsed.nodes);
  return content.queries.length > 0 || content.mutations.length > 0 || hasBoundSource(body);
}

/**
 * Does this document carry a BOUND IMAGE SOURCE — `<img src="$pick">`, or the
 * braced `src="https://cdn.x.com/{$pick}.png"`?
 *
 * The third reader interaction that reaches the server, and the only one that
 * lives in the BODY rather than in `<Helmet>`, which is why it is a tree walk
 * here rather than a field of the split above. The URL a reader picks is
 * imported through `/a/<id>/assets`, and the frame cannot load that for itself:
 * a served document is sandboxed without `allow-same-origin`, so its `<img>`
 * carries no cookie, and a private document answers the uniform 404 — for its
 * OWNER's own framed copy exactly as for a stranger, which is the default case
 * since a signed-in user's document is born private. So such a document keeps
 * its parent page, where the session is, precisely as one declaring a query
 * does (lib/story-runtime/contract STORY_ASSET_MESSAGE).
 *
 * Private to this module and reached through `declaresLiveData` alone: the one
 * question anybody asks is that one, and a second exported spelling of half an
 * answer is a second thing to keep in step. `carriesRef` is the dataflow's own
 * answer to "is this a reference", so this cannot drift from what the renderer
 * binds; the nodes are the ones `declaresLiveData` already parsed, so a
 * document pays one parse, not two, on every read.
 */
const hasBoundSource = (nodes: JsxNode[]): boolean => nodes.some((n) => {
  if (n.type !== 'element') return false;
  if (!n.isComponent && n.tag.toLowerCase() === 'img') {
    const src = n.attributes.find((a) => a.name.toLowerCase() === 'src');
    if (src?.value.static && carriesRef(src.value.json)) return true;
  }
  return hasBoundSource(n.children);
});

/** Split Helmet out of the tree wherever it sits; body keeps original node spans. */
export function splitHelmet(nodes: JsxNode[]): HelmetSplit {
  // Trees are not mutated once parsed, so one tree's split is answered once: the editor's title, tables, query
  // cells and draft all ask for the same (shared) tree's at each pause, and each asking walked all of it.
  const kept = splits.get(nodes);
  if (kept) return kept;
  const helmet = findHelmets(nodes)[0] ?? null;
  const split = helmet ? { helmet, content: helmetContent(helmet), body: withoutHelmets(nodes) } : { helmet: null, content: EMPTY_HELMET_CONTENT, body: nodes };
  splits.set(nodes, split);
  return split;
}
const splits = new WeakMap<JsxNode[], HelmetSplit>();

/**
 * Canonical placement: the Helmet (if any) as FIRST top-level node, body order
 * preserved. Pure node transform, a fixpoint — canonicalizeMarkup serializes
 * its output, so stored documents always carry the Helmet first.
 */
export function hoistHelmet(nodes: JsxNode[]): JsxNode[] {
  const { helmet, body } = splitHelmet(nodes);
  return helmet ? [helmet, ...body] : nodes;
}
