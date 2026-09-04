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
 *  - no attributes on `<Helmet>` or its children;
 *  - children: at most one each of `<title>`, `<style>`, `<script>`, plus any
 *    number of `<meta>` (unique `name`s) and of the DATA declarations
 *    `<Value>` / `<Query>` / `<Mutation>` (lib/story/dataflow.ts owns their shape and the
 *    `$name` reference rules; the grammar here only admits them);
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
import { MUTATION_TAG, QUERY_TAG, VALUE_TAG, carriesRef, parseMutationDecl, parseQueryDecl, parseValueDecl, type MutationDecl, type QueryDecl, type ValueDecl } from './dataflow';

export const HELMET_TAG = 'Helmet';

/** A `<meta name content>` pair — the only meta shape the grammar admits. */
export interface HelmetMeta {
  name: string;
  content: string;
}

/** What a Helmet carries, extracted as plain strings ('' = tag absent). */
export interface HelmetContent {
  title: string | null;
  style: string | null;
  script: string | null;
  /** `<meta name content>` pairs in authored order; names are unique. */
  meta: HelmetMeta[];
  /** `<Value>` declarations in authored order (lib/story/dataflow.ts). */
  values: ValueDecl[];
  /** `<Query>` declarations in authored order (lib/story/dataflow.ts). */
  queries: QueryDecl[];
  /** `<Mutation>` declarations in authored order (lib/story/dataflow.ts). */
  mutations: MutationDecl[];
}

export interface HelmetSplit {
  /** The document's Helmet element, or null. (Multiple = validation error; split returns the first.) */
  helmet: JsxElement | null;
  content: HelmetContent;
  /** The tree with every Helmet subtree removed; remaining nodes keep their original source spans. */
  body: JsxNode[];
}

export const EMPTY_HELMET_CONTENT: HelmetContent = { title: null, style: null, script: null, meta: [], values: [], queries: [], mutations: [] };

/** The three DATA declarations a Helmet may repeat (lib/story/dataflow.ts owns their shapes). */
const DATA_TAGS: Record<string, (el: JsxElement) => { ok: true; decl: ValueDecl | QueryDecl | MutationDecl } | { ok: false; errors: ValidationError[] }> = {
  [VALUE_TAG]: parseValueDecl,
  [QUERY_TAG]: parseQueryDecl,
  [MUTATION_TAG]: parseMutationDecl,
};

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

  const seen = new Set<HelmetChildTag>();
  const seenMetaNames = new Set<string>();
  for (const child of contentChildren(helmet)) {
    // The two DATA declarations (lib/story/dataflow.ts owns their shape; the
    // grammar here only knows they exist and repeat). Graph-level rules —
    // duplicate names, undeclared `$refs`, cycles — involve the body and run
    // in publishJsx's always-on pass, not here.
    if (child.type === 'element' && child.isComponent && DATA_TAGS[child.tag]) {
      const parsed = DATA_TAGS[child.tag](child);
      if (!parsed.ok) errors.push(...parsed.errors);
      continue;
    }
    if (child.type !== 'element' || !(CHILD_TAGS as readonly string[]).includes(child.tag.toLowerCase()) || child.isComponent) {
      errors.push({
        message: `<Helmet> may only contain <title>, <style>, <script>, <meta>, <Value>, <Query>, <Mutation>`,
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
      seenMetaNames.add(nameValue);
      continue;
    }

    const singleton = tag as HelmetChildTag;
    if (seen.has(singleton)) {
      errors.push({ message: `<Helmet> may carry at most one <${singleton}>`, tag, start: child.start, end: child.end });
      continue;
    }
    seen.add(singleton);
    if (child.attributes.length > 0) {
      const a = child.attributes[0];
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
  const content: HelmetContent = { ...EMPTY_HELMET_CONTENT, meta: [], values: [], queries: [], mutations: [] };
  for (const child of contentChildren(helmet)) {
    if (child.type !== 'element') continue;
    if (child.isComponent) {
      if (child.tag === VALUE_TAG) { const p = parseValueDecl(child); if (p.ok) content.values.push(p.decl); }
      else if (child.tag === QUERY_TAG) { const p = parseQueryDecl(child); if (p.ok) content.queries.push(p.decl); }
      else if (child.tag === MUTATION_TAG) { const p = parseMutationDecl(child); if (p.ok) content.mutations.push(p.decl); }
      continue;
    }
    const tag = child.tag.toLowerCase();
    if (tag === 'title' || tag === 'style' || tag === 'script') {
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
  for (const n of nodes) {
    if (n.type !== 'element') { out.push(n); continue; }
    if (isHelmet(n)) continue;
    const children = withoutHelmets(n.children);
    out.push(children === n.children || children.every((c, i) => c === n.children[i]) && children.length === n.children.length
      ? n
      : { ...n, children });
  }
  return out;
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
 * (lib/story-runtime/document-transport), which a private document answers
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
 * lives in the BODY rather than in `<Helmet>`. The URL a reader picks is
 * imported through `/a/<id>/assets`, and the frame cannot load that for itself:
 * a served document is sandboxed without `allow-same-origin`, so its `<img>`
 * carries no cookie, and a private document answers the uniform 404 — for its
 * OWNER's own framed copy exactly as for a stranger, which is the default case
 * since a signed-in user's document is born private. So such a document keeps
 * its parent page, where the session is, precisely as one declaring a query
 * does (lib/story-runtime/contract STORY_ASSET_MESSAGE).
 *
 * Parsed, never pattern-matched, and never throwing: `$pick` in prose is prose,
 * a literal URL is not a binding (publish already imported it), and source that
 * does not parse declares nothing. `carriesRef` is the dataflow's own answer to
 * "is this a reference", so this cannot drift from what the renderer binds.
 */
export function declaresBoundSources(source: string | null | undefined): boolean {
  if (!source) return false;
  const parsed = parseJsx(source);
  if (!parsed.ok) return false;
  return hasBoundSource(splitHelmet(parsed.nodes).body);
}

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
  const helmet = findHelmets(nodes)[0] ?? null;
  if (!helmet) return { helmet: null, content: EMPTY_HELMET_CONTENT, body: nodes };
  return { helmet, content: helmetContent(helmet), body: withoutHelmets(nodes) };
}

/**
 * Canonical placement: the Helmet (if any) as FIRST top-level node, body order
 * preserved. Pure node transform, a fixpoint — canonicalizeMarkup serializes
 * its output, so stored documents always carry the Helmet first.
 */
export function hoistHelmet(nodes: JsxNode[]): JsxNode[] {
  const { helmet, body } = splitHelmet(nodes);
  return helmet ? [helmet, ...body] : nodes;
}
