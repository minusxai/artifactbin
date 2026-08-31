/**
 * Static-subset + security validator for a parsed `jsx` AST. Returns a list of
 * {@link ValidationError} (empty = valid). This is the boundary that makes `jsx`
 * inert DATA: only JSON-literal attributes, only registered components / allowed
 * HTML tags, no event handlers, no dangerous URL schemes. A JSX parser does NOT
 * give the "static" guarantee for free — this pass enforces it.
 */
import { immutableSet } from '@/lib/utils/immutable-collections';
// Shared with the render-time gate in lib/story-ui/interpreter.tsx — see
// lib/jsx/url-attrs.ts for why these must not be maintained separately.
import { URL_ATTRS, URL_LIST_ATTRS, SVG_PAINT_ATTRS, paintHasExternalUrl } from './url-attrs';
import { DANGEROUS_TAGS } from './dangerous-tags';
import { STORY_COMPONENT_NAMES } from '@/lib/data/story/story-components';
import type { JsxNode, JsxElement, ValidationError, ValidateOptions } from './types';

// The retired legacy story design-system tags (<PageHeader>, <Eyebrow>, …). When one of
// these shows up unregistered (a new-format story validated against the shadcn registry),
// the error steers the model to the CURRENT authoring path instead of letting it retry
// the same legacy tags.
const LEGACY_STORY_COMPONENT_NAMES = immutableSet(STORY_COMPONENT_NAMES);

// Lowercase HTML tags that can introduce active content / navigation hijacking.
// Shared with the read-time gates (see lib/jsx/dangerous-tags.ts) — the same
// no-second-copy rule as URL_ATTRS above it.

// Attributes whose value is a URL — checked against dangerous schemes. `srcset` and `ping`
// carry URL LISTS (comma/space separated) and are checked per entry.

// Attributes rejected by NAME on every tag: HTML injection (dangerouslySetInnerHTML, srcdoc),
// React internals (ref/key — never serializable data), and customized built-ins (is).
const DENIED_ATTRS = immutableSet(['dangerouslysetinnerhtml', 'ref', 'key', 'srcdoc', 'is']);

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

/** Scheme-check every URL in a srcset/ping-style list ("url descriptor, url descriptor"). */
export function listHasDangerousScheme(value: string): boolean {
  return value.split(',').some(entry => {
    const url = entry.trim().split(/\s+/)[0];
    return !!url && hasDangerousScheme(url);
  });
}

export function validateJsx(nodes: JsxNode[], options: ValidateOptions): ValidationError[] {
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
): void {
  if (node.type === 'expression') {
    if (!node.value.static) {
      errors.push({ message: `Expression child must be a JSON literal, got ${node.value.exprType}`, start: node.start, end: node.end });
    }
    return;
  }
  if (node.type === 'text') return;
  validateElement(node, components, allowedHtml, stylePolicy, errors, inSvg);
  const childrenInSvg = inSvg || (!node.isComponent && node.tag.toLowerCase() === 'svg');
  for (const child of node.children) walk(child, components, allowedHtml, stylePolicy, errors, childrenInSvg);
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
   * Document-level tags have ONE home: `<Helmet>` (lib/story/helmet.ts). In the
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
    iframe: 'use the <Video> component for the sanctioned embed hosts',
    object: 'use the <Video> component, or <img>/<video> with a ref: source',
    embed: 'use the <Video> component, or <img>/<video> with a ref: source',
    script: 'a document carries ONE script, in <Helmet><script>{`…`}</script></Helmet>',
    link: 'no external stylesheets or fonts — style with className, or <Helmet><style>',
    meta: '<meta name content /> belongs in <Helmet>; http-equiv is the document\'s own to set',
    base: 'the document sets its own base target; relative links already resolve',
    noscript: 'the document always runs its script — write the content directly',
  };

  /**
   * The document's DATA declarations are Helmet children, never body nodes
   * (lib/story/dataflow.ts). Named here so an author who writes one in the body
   * is told where it goes instead of only that it is unknown.
   */
  const HELMET_ONLY_COMPONENTS: Record<string, string> = {
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
    if (!components.has(el.tag)) {
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
    // (`allowed_html_tags`, lib/story/jsx-tier.ts), as `unknown_theme` does.
    errors.push({
      message: `Tag <${el.tag}> is not in the allowed HTML tag list — see allowed_html_tags`,
      tag: el.tag, start: el.start, end: el.end,
    });
  }

  for (const a of el.attributes) {
    // Spread / non-static attribute values.
    if (!a.value.static) {
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
        ? listHasDangerousScheme(a.value.json)
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
