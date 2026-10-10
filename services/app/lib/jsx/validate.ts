/**
 * Static-subset + security validator for a parsed `jsx` AST. Returns a list of
 * {@link ValidationError} (empty = valid). This is the boundary that makes `jsx`
 * DATA: JSON literals and allowlisted reactive/row expressions in permitted
 * scopes, registered components / allowed HTML tags, no event handlers, and no
 * dangerous URL schemes. Parsing alone does not enforce these constraints.
 */
import { mermaidSourceError } from './mermaid-source';
import { markdownContent, markdownSource } from '@/lib/markdown/content';
import { validateDeckMap } from './deck-spec';
import { parseRowRef } from './row-scope';
import { isReactiveExpression, reactiveNames, REACTIVE_BOOLEAN_PROPS } from './reactive';
import { immutableSet } from '@/lib/jsx/immutable-set';
// Shared with the render-time gate in lib/story-ui/interpreter-primitives — see
// lib/jsx/url-attrs.ts for why these must not be maintained separately.
import { URL_ATTRS, URL_LIST_ATTRS, SVG_PAINT_ATTRS, paintHasExternalUrl, urlListUrls } from './url-attrs';
import { DANGEROUS_TAGS } from './dangerous-tags';
import { DENIED_JSX_ATTRS } from './denied-attrs';
import { STORY_COMPONENT_NAMES } from './story-components';
import { STORY_SVG_TAGS } from './component-names';
import type { JsxNode, JsxElement, ValidationError, ValidateOptions } from './types';

// The retired legacy story design-system tags (<PageHeader>, <Eyebrow>, …). When one of
// these shows up unregistered (a new-format story validated against the shadcn registry),
// the error steers the model to the CURRENT authoring path instead of letting it retry
// the same legacy tags.
const LEGACY_STORY_COMPONENT_NAMES = immutableSet(STORY_COMPONENT_NAMES);

// Attributes rejected by NAME on every tag: HTML injection (dangerouslySetInnerHTML, srcdoc),
// React internals (ref/key — never serializable data), and customized built-ins (is).
const DENIED_ATTRS = DENIED_JSX_ATTRS;

// Agent-authored styling escape hatches. `labelStyle` is the one historical component-specific
// alias (<Param>); keep this list explicit so unrelated data props are never rejected by suffix.
const INLINE_STYLE_ATTRS = immutableSet(['style', 'labelstyle']);

// `data:image/...` is allowed (inline images); other `data:` (e.g. text/html) is not.
const DANGEROUS_URL = /^(javascript|vbscript|data):/i;
const SAFE_DATA_URL = /^data:image\//i;

/**
 * True when a URL value carries a dangerous scheme. Browsers strip ASCII control chars and
 * spaces INSIDE the scheme before resolving (`java\tscript:` runs as `javascript:`), so the
 * check normalizes the same way instead of trusting the raw string.
 */
export function hasDangerousScheme(url: string): boolean {
  // eslint-disable-next-line no-control-regex -- deliberately mirrors browser scheme normalization
  const normalized = url.replace(/[\x00-\x20]/g, '');
  return DANGEROUS_URL.test(normalized) && !SAFE_DATA_URL.test(normalized);
}

/** Check ping's ASCII-whitespace-separated URLs or srcset's comma-separated URL/descriptor entries. */
export function listHasDangerousScheme(value: string, lowerAttributeName: string): boolean {
  return urlListUrls(value, lowerAttributeName).some(hasDangerousScheme);
}

/** The script's components for the validateJsx run in progress (synchronous; see ValidateOptions.scriptComponents). */
let scriptComponents: ReadonlySet<string> | 'any' = new Set<string>();
const isScriptComponent = (el: JsxElement): boolean => el.isComponent && (scriptComponents === 'any' ? !JSX_REGISTERED.has(el.tag) : scriptComponents.has(el.tag));
let JSX_REGISTERED: ReadonlySet<string> = new Set<string>();

export function validateJsx(nodes: JsxNode[], options: ValidateOptions): ValidationError[] {
  scriptComponents = options.scriptComponents ?? new Set<string>();
  JSX_REGISTERED = new Set(options.components);
  try { return validateJsxNodes(nodes, options); }
  finally { scriptComponents = new Set<string>(); }
}

function validateJsxNodes(nodes: JsxNode[], options: ValidateOptions): ValidationError[] {
  const components = new Set(options.components);
  // Case-insensitive: tags are compared lowercased below, so an allowlist may
  // carry canonical SVG casing (`clipPath`) and still match authored variants.
  const allowedHtml = options.allowedHtmlTags ? new Set([...options.allowedHtmlTags].map(t => t.toLowerCase())) : null;
  const errors: ValidationError[] = [];
  for (const node of nodes) walk(node, components, allowedHtml, options.stylePolicy ?? 'allow', errors, false);
  return errors;
}

function walk(
  node: JsxNode,
  components: Set<string>,
  allowedHtml: Set<string> | null,
  stylePolicy: 'allow' | 'no-inline-style',
  errors: ValidationError[],
  /** Inside an `<svg>` subtree, where `<title>` is the accessibility label. */
  inSvg: boolean,
  inColumn = false,
  parent?: string,
  inFor = false,
): void {
  if (node.type === 'expression') {
    if (!node.value.static && isReactiveExpression(node.value.reactive)) {
      if (!inColumn && reactiveNames(node.value.reactive).fields.length) errors.push({message: 'Row expressions belong inside a DataTable Column', start: node.start, end: node.end});
      return;
    }
    if (!node.value.static && !(inColumn && parseRowRef(node.source.trim()))) {
      errors.push({ message: `Expression child must be a JSON literal, got ${node.value.exprType}`, start: node.start, end: node.end });
    }
    return;
  }
  if (node.type === 'text') return;
  if (node.control) {
    const fragment = node.control.kind === 'fragment';
    if (node.tag !== (fragment ? '__mx_fragment' : '__mx_condition') || node.attributes.length
      || (node.control.kind !== 'fragment' && (node.children.length !== 2 || !isReactiveExpression(node.control.test)))) {
      errors.push({message: 'Invalid conditional structure', start: node.start, end: node.end});
      return;
    }
    if (node.control.kind !== 'fragment' && !inColumn && reactiveNames(node.control.test).fields.length) errors.push({message: 'Row conditions belong inside a DataTable Column', start: node.start, end: node.end});
    for (const child of node.children) walk(child, components, allowedHtml, stylePolicy, errors, inSvg, inColumn, parent, inFor);
    return;
  }
  if (inFor && node.attributes.some(a=>(['value','checked','options'].includes(a.name) || (a.name === 'run' && node.tag !== 'Button')) && a.value.static && typeof a.value.json === 'string' && /^\$[A-Za-z_]\w*$/.test(a.value.json))) errors.push({message:'Bound controls inside For are not supported; use editable DataTable columns',start:node.start,end:node.end});
  if (inFor && node.tag === 'DataTable') errors.push({message:'DataTable must be outside For templates',start:node.start,end:node.end});
  if (node.tag === 'For') {
    const key = node.attributes.find(a => a.name === 'keyBy')?.value;
    const eachValue = node.attributes.find(a => a.name === 'each')?.value;
    const each = eachValue && !eachValue.static ? eachValue.reactive : undefined;
    if (inColumn) errors.push({message:'Nested For is not supported',start:node.start,end:node.end});
    if (each?.kind !== 'signal') errors.push({message:'For requires each={$table}',start:node.start,end:node.end});
    if (key && (!key.static || typeof key.json !== 'string' || !key.json)) errors.push({message:'For keyBy must be a nonempty field name when supplied',start:node.start,end:node.end});
    if (inSvg) for (const stray of nonSvgTemplateElements(node.children)) errors.push({message:`<For> inside <svg> repeats SVG drawing tags only (${STORY_SVG_TAGS.join(' ')}); <${stray.tag}> would break out of the drawing`,tag:stray.tag,start:stray.start,end:stray.end});
  }
  validateElement(node, components, allowedHtml, stylePolicy, errors, inSvg);
  if (node.tag === 'Markdown') {
    const source = markdownSource(node);
    const messages = source === null ? ['Markdown children must be a literal string, for example <Markdown>{`## Heading\\n\\nProse`}</Markdown>.'] : markdownContent(source).errors;
    for (const message of messages) errors.push({ message, tag: node.tag, start: node.start, end: node.end });
    if (inFor || inColumn || node.attributes.some(a => !a.value.static)) errors.push({ message: 'Markdown is a static editable prose region; keep it outside row templates and use literal props.', tag: node.tag, start: node.start, end: node.end });
  }
  if(node.tag==='Grid') {
    const mode=node.attributes.find(a=>a.name==='mode')?.value;
    if(mode?.static && mode.json!=='flow' && mode.json!=='positioned') errors.push({message:'Grid mode must be flow or positioned',start:node.start,end:node.end});
    if(mode?.static && mode.json==='flow') for(const item of node.children) {
      if(item.type!=='element'||item.tag!=='GridItem')continue;
      if(item.attributes.some(a=>['x','y','h'].includes(a.name))) errors.push({message:'Flow GridItem uses w and optional minHeight, not positioned x/y/h',start:item.start,end:item.end});
      const height=item.attributes.find(a=>a.name==='minHeight')?.value;
      if(height?.static && (typeof height.json!=='number'||!Number.isFinite(height.json)||height.json<0||height.json>10000)) errors.push({message:'Flow GridItem minHeight must be a number from 0 to 10000 pixels',start:item.start,end:item.end});
    }
    if(!(mode?.static && mode.json==='flow')) {
      const unplaced=node.children.filter(item=>item.type==='element'&&item.tag==='GridItem'&&!item.attributes.some(a=>a.name==='x'||a.name==='y'));
      if(unplaced.length>1) for(const item of unplaced.slice(1)) errors.push({message:'Positioned GridItems without x/y all sit at 0,0 and overlap; give each x and y, or use <Grid mode="flow"> for columns that stack',start:item.start,end:item.end});
    }
  }
  for (const attr of node.attributes) if (!inColumn && !attr.value.static && isReactiveExpression(attr.value.reactive) && reactiveNames(attr.value.reactive).fields.length) {
    errors.push({message: 'Row expressions belong inside a DataTable Column', start: attr.start, end: attr.end});
  }
  if (node.tag === 'FileUpload') {
    for (const key of ['dataset', 'value', 'busy']) {
      const value = node.attributes.find(a => a.name === key)?.value;
      if (key === 'busy' && !value) continue;
      const valid = value?.static && typeof value.json === 'string' && (key === 'dataset' ? /^[A-Za-z][A-Za-z0-9_]*$/.test(value.json) : /^\$[A-Za-z][A-Za-z0-9_]*$/.test(value.json));
      if (!valid) errors.push({message: key === 'dataset' ? 'FileUpload dataset must name a declared Import (literal name, without $)' : `FileUpload ${key} must bind a declared ${key === 'busy' ? 'boolean' : 'string'} Value with "$name"`, tag: node.tag, attr: key, start: node.start, end: node.end});
    }
    const max = node.attributes.find(a => a.name === 'maxFiles')?.value;
    if (max && (!max.static || typeof max.json !== 'number' || !Number.isInteger(max.json) || max.json < 1)) errors.push({message: 'FileUpload maxFiles must be a positive integer', tag: node.tag, attr: 'maxFiles', start: node.start, end: node.end});
  }
  if (node.tag === 'Mermaid') {
    const code = node.attributes.find(a => a.name === 'code')?.value;
    const error = mermaidSourceError(code?.static ? code.json : undefined);
    if (error) errors.push({ message: error, tag: node.tag, start: node.start, end: node.end });
  }
  if (node.isComponent && node.tag === 'DeckGL') {
    const prop = (name: string) => {
      const value = node.attributes.find(a => a.name === name)?.value;
      return value?.static ? value.json : value ? null : undefined;
    };
    for (const message of validateDeckMap({ layers: prop('layers'), basemap: prop('basemap'), initialViewState: prop('initialViewState'), tooltip: prop('tooltip'), legend: prop('legend'), title: prop('title') })) {
      errors.push({ message, tag: node.tag, start: node.start, end: node.end });
    }
  }
  const childrenInSvg = inSvg || (!node.isComponent && node.tag.toLowerCase() === 'svg');
  for (const child of node.children) walk(child, components, allowedHtml, stylePolicy, errors, childrenInSvg, node.tag === 'For' ? true : node.tag === 'Column' ? parent === 'DataTable' : node.tag === 'DataTable' ? false : inColumn, node.tag, inFor || node.tag === 'For');
}

const SVG_TAGS: ReadonlySet<string> = new Set(STORY_SVG_TAGS.map((t) => t.toLowerCase()));

/**
 * What a `<For>` inside `<svg>` would draw that is not SVG. The interpreter
 * wraps those rows in a `<g>`, so they parse back as written only while they
 * are SVG too: an HTML tag — or a component, which renders HTML — breaks out
 * of the drawing and fails hydration (lib/document/nesting.ts). Conditions and
 * fragments render their children in place, so the search looks through them.
 */
function nonSvgTemplateElements(nodes: JsxNode[]): JsxElement[] {
  return nodes.flatMap((n) => n.type !== 'element' ? []
    : n.control ? nonSvgTemplateElements(n.children)
    : n.isComponent || !SVG_TAGS.has(n.tag.toLowerCase()) ? [n] : []);
}

function validateElement(
  el: JsxElement,
  components: Set<string>,
  allowedHtml: Set<string> | null,
  stylePolicy: 'allow' | 'no-inline-style',
  errors: ValidationError[],
  inSvg: boolean,
): void {
  const lower = el.isComponent ? '' : el.tag.toLowerCase();
  /*
   * Document-level tags have ONE home: `<Helmet>` (lib/document/helmet.ts). In the
   * body they are not a second opinion, they are a second door —
   *
   *  - `<title>`: the HTML parser processes a body `<title>` under the in-head
   *    rules and React hoists it too, so on a hydrating document it lands in
   *    <head> and BEATS the Helmet's title (measured: a tab reading HIJACKED);
   *  - `<style>`: CSS in a body block is not scoped to where it sits, it styles
   *    the whole document — which is what "document-level" means.
   *
   * SVG's `<title>` is a different element that shares the name (an
   * accessibility label), so it stays legal inside an `<svg>` subtree.
   */
  /** What an author should reach for instead of a denied tag. */
  const DENIED_ALTERNATIVES: Record<string, string> = {
    form: 'the controls work without a <form> (<input>, <select>, <button>); drive them from the <Helmet> script',
    object: 'use <iframe src="https://…"> for a player or page, or <img>/<video> with a ref: source',
    embed: 'use <iframe src="https://…"> for a player or page, or <img>/<video> with a ref: source',
    script: 'scripts belong in <Helmet>: one browser <script>{`…`}</script> and optionally one <script type="server">{`…`}</script>',
    link: 'put @import url(…) or @font-face in <Helmet><style>{`…`}</style></Helmet>; there is no <link>',
    meta: '<meta name content /> belongs in <Helmet>; http-equiv is the document\'s own to set',
    base: 'the document sets its own base target; relative links already resolve',
    noscript: 'the document always runs its script — write the content directly',
  };

  /**
   * The document's DATA declarations are Helmet children, never body nodes
   * (lib/dataflow/dataflow.ts). Named here so an author who writes one in the body
   * is told where it goes instead of only that it is unknown.
   */
  const HELMET_ONLY_COMPONENTS: Record<string, string> = {
    Context: '<Context> belongs directly in <Helmet>: <Context src="ref:<documentId>" /> links a supporting document without rendering it in the body.',
    Notify: '<Notify> is a notification declaration and belongs directly in <Helmet>, beside the Mutation named by on=.',
    Param: '<Param> is retired. Declare the value in <Helmet> — <Value name="region" type="string" /> — and bind a NATIVE control to it in the body: <select value="$region" options="$regions" /> (options from a <Query>), <input type="range" value="$n" />, <input type="checkbox" checked="$flag" />. Reference it in SQL as $region.',
    Value: '<Value> is a data declaration and belongs in <Helmet>: <Helmet><Value name="…" type="…" /></Helmet>; refer to it as "$name" from the body.',
    Query: '<Query> is a data declaration and belongs in <Helmet>: <Helmet><Query name="…">{`select …`}</Query></Helmet>; bind it with data="$name".',
  };

  const DOCUMENT_LEVEL: Record<string, string> = {
    title: `a <title> in the body is hoisted into <head> and would override the document's own title. (SVG's <title> is fine inside <svg>.)`,
    style: `CSS in a body <style> applies to the whole document wherever it sits`,
  };

  // Tag allowlist.
  if (el.isComponent) {
    if (!components.has(el.tag) && !isScriptComponent(el)) {
      // Stable prefix (asserted by callers/tests) + recovery guidance: name the legacy
      // trap when it applies, and ALWAYS list the registered set so the model can pick
      // a real component instead of retrying the same unknown tag.
      let message = `Unknown component <${el.tag}> — not in the component registry.`;
      if (HELMET_ONLY_COMPONENTS[el.tag]) {
        message += ` ${HELMET_ONLY_COMPONENTS[el.tag]}`;
      } else if (LEGACY_STORY_COMPONENT_NAMES.has(el.tag)) {
        message += ` <${el.tag}> is a LEGACY story component that is no longer available — rebuild it with plain HTML tags + Tailwind utilities, or use the registered components.`;
      }
      message += ` Registered components: ${[...components].join(', ')}.`;
      errors.push({ message, tag: el.tag, start: el.start, end: el.end });
    }
  } else if (DOCUMENT_LEVEL[lower] && !(lower === 'title' && inSvg)) {
    errors.push({
      message: `<${lower}> belongs in <Helmet><${lower}>…</${lower}></Helmet> — ${DOCUMENT_LEVEL[lower]}`,
      tag: el.tag, start: el.start, end: el.end,
    });
  } else if (DANGEROUS_TAGS.has(el.tag.toLowerCase())) {
    /*
     * Say what to do instead. Every other rejection here already does — the
     * unknown component lists the registry, a refused tag points at
     * `allowed_html_tags`, a document-level tag names the Helmet — while this
     * one stopped at "no". Guidance costs nothing in an agent's context: it is
     * paid only by the request that got it wrong. Tags with no alternative
     * simply keep the bare refusal.
     */
    const instead = DENIED_ALTERNATIVES[el.tag.toLowerCase()];
    errors.push({
      message: `Disallowed tag <${el.tag}>${instead ? ` — ${instead}` : ''}`,
      tag: el.tag, start: el.start, end: el.end,
    });
  } else if (allowedHtml && !allowedHtml.has(el.tag.toLowerCase())) {
    // The message stays SHORT on purpose. The model still needs the set to
    // recover, but repeating ~130 tokens of vocabulary per offending tag bloats
    // a response that may carry many — so the door attaches it ONCE
    // (`allowed_html_tags`, lib/publish/document/jsx-tier.ts), as `unknown_theme` does.
    errors.push({
      message: `Tag <${el.tag}> is not in the allowed HTML tag list — see allowed_html_tags`,
      tag: el.tag, start: el.start, end: el.end,
    });
  }

  if (lower === 'iframe') errors.push(...iframeErrors(el));

  for (const a of el.attributes) {
    // Spread / non-static attribute values.
    if (!a.value.static) {
      if (el.tag === 'For' && a.name === 'each' && a.value.reactive?.kind === 'signal') continue;
      // A script component's prop may be a declared name: it mounts with that signal.
      if (isScriptComponent(el) && a.value.reactive?.kind === 'signal') continue;
      if (REACTIVE_BOOLEAN_PROPS.has(a.name) && isReactiveExpression(a.value.reactive)) continue;
      errors.push({
        message: `Attribute "${a.name}" must be a JSON literal, got ${a.value.exprType}`,
        attr: a.name, tag: el.tag, start: a.start, end: a.end,
      });
      continue;
    }
    // Event handlers (on*) are executable — never allowed.
    if (/^on/i.test(a.name)) {
      errors.push({ message: `Event handler attribute "${a.name}" is not allowed`, attr: a.name, tag: el.tag, start: a.start, end: a.end });
      continue;
    }
    // Name-denied attributes (HTML injection / React internals / customized built-ins).
    if (DENIED_ATTRS.has(a.name.toLowerCase())) {
      errors.push({ message: `Attribute "${a.name}" is not allowed`, attr: a.name, tag: el.tag, start: a.start, end: a.end });
      continue;
    }
    if (stylePolicy === 'no-inline-style' && INLINE_STYLE_ATTRS.has(a.name.toLowerCase())) {
      errors.push({
        message: `Inline style attribute "${a.name}" is not allowed; use className utilities, or put custom CSS in <Helmet><style>{\`…\`}</style></Helmet> and reference it by class`,
        attr: a.name,
        tag: el.tag,
        start: a.start,
        end: a.end,
      });
      continue;
    }
    // Dangerous URL schemes in URL-bearing attributes (list-valued ones checked per entry).
    if (typeof a.value.json === 'string') {
      const lower = a.name.toLowerCase();
      const dangerous = URL_LIST_ATTRS.has(lower)
        ? listHasDangerousScheme(a.value.json, lower)
        : URL_ATTRS.has(lower) && hasDangerousScheme(a.value.json);
      if (dangerous) {
        errors.push({ message: `Attribute "${a.name}" has a disallowed URL scheme`, attr: a.name, tag: el.tag, start: a.start, end: a.end });
      }
      // SVG paint references must stay local: url(#id) only (see url-attrs.ts).
      if (SVG_PAINT_ATTRS.has(lower) && paintHasExternalUrl(a.value.json)) {
        errors.push({ message: `Attribute "${a.name}" may only reference a local url(#id) target`, attr: a.name, tag: el.tag, start: a.start, end: a.end });
      }
    }
  }
}

/**
 * THE AUTHOR'S `<iframe>`: a player or page, framed as written. The document runs on its own origin under its own
 * CSP (lib/page-styles/document-csp), whose `frame-src` is what decides which hosts actually load — the kit's former
 * embed hosts by default, plus any the document declares with `<meta name="csp-frame">`. This gate keeps the element
 * itself narrow: an https `src` (never `srcdoc`, never `data:`/`http:`), no children, and only the attributes that
 * size, label and permit a player. `id` is every body element's persistent identity, so it is allowed too.
 */
const IFRAME_ATTRS = immutableSet(['src', 'title', 'width', 'height', 'allow', 'allowfullscreen', 'loading', 'classname', 'style', 'id']);
const IFRAME_ATTR_LIST = 'src, title, width, height, allow, allowfullscreen, loading, className, style';

function isHttpsUrl(value: string): boolean {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}

function iframeErrors(el: JsxElement): ValidationError[] {
  const errors: ValidationError[] = [];
  for (const a of el.attributes) {
    const name = a.name.toLowerCase();
    // Handlers and name-denied attributes (`srcdoc`) are refused by the general rules below, once.
    if (IFRAME_ATTRS.has(name) || /^on/i.test(a.name) || DENIED_ATTRS.has(name)) continue;
    errors.push({ message: `Attribute "${a.name}" is not allowed on <iframe> — it takes only ${IFRAME_ATTR_LIST}`, attr: a.name, tag: el.tag, start: a.start, end: a.end });
  }
  const src = el.attributes.find((a) => a.name.toLowerCase() === 'src');
  const value = src?.value.static && typeof src.value.json === 'string' ? src.value.json : null;
  if (value === null || !isHttpsUrl(value)) {
    errors.push({
      message: '<iframe> needs src="https://…" — an https player or page. Popular players and posts (YouTube, Vimeo, Loom, X, Instagram, TikTok, Spotify, Figma, CodePen and more) frame by default; declare any other host with <meta name="csp-frame" content="https://…" /> in <Helmet>',
      attr: 'src', tag: el.tag, start: src?.start ?? el.start, end: src?.end ?? el.end,
    });
  }
  if (el.children.some((c) => c.type !== 'text' || c.value.trim() !== '')) {
    errors.push({ message: '<iframe> takes no children — write it self-closing: <iframe src="https://…" title="…" />', tag: el.tag, start: el.start, end: el.end });
  }
  return errors;
}
