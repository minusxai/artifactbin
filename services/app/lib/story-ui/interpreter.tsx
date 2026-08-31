/**
 * Story interpreter: validated static-JSX AST → React elements over an
 * injected component registry. No eval, ever — the AST is data, the registry is code we ship.
 *
 * Runs inside the document's own React tree (the runtime hydrates it there).
 * Defense in depth: `validateJsxSource` is the
 * authoring gate, but the interpreter independently drops dangerous props (handlers, HTML
 * injection, dangerous URL schemes), so an unvalidated AST still can't reach React unsafely.
 *
 * Every element is stamped with `data-mx-ast` (its path in the AST, e.g. "0.2.1") — the
 * WYSIWYG write-back uses it to map a DOM edit to the JSX source node it came from. The
 * stamped DOM is render output only; new-format stories persist JSX source, never DOM.
 */
import React from 'react';
import type { JsxNode, JsxElement } from '@/lib/jsx';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { hasDangerousScheme, listHasDangerousScheme } from '@/lib/jsx/validate';
// Shared with the save-time gate in lib/jsx/validate.ts — see lib/jsx/url-attrs.ts
// for why these must not be maintained separately.
import { URL_ATTRS as URL_PROPS, URL_LIST_ATTRS as URL_LIST_PROPS, SVG_PAINT_ATTRS, paintHasExternalUrl } from '@/lib/jsx/url-attrs';
import { STORY_SVG_TAGS } from './component-names';
import { REF_ATTRS, refName } from '@/lib/story/dataflow';
import type { JsxAttribute } from '@/lib/jsx';

/**
 * A native form control whose `value`/`checked`/`options` is a `$name`
 * reference (lib/story/dataflow.ts REF_ATTRS). The interpreter hands the
 * element to the registered `boundControl` component instead of the tag: the
 * bound attributes are REMOVED from `props` (a literal "$region" must never
 * reach the DOM) and named in `bind`, so the control can read and write the
 * document's store. Authored children (a `<select>`'s own `<option>`s) pass
 * through.
 */
export interface BoundControlProps {
  tag: 'input' | 'select' | 'textarea';
  props: Record<string, unknown>;
  bind: { value?: string; checked?: string; options?: string };
  children?: React.ReactNode;
}

export interface StoryInterpreterOptions {
  /** Component registry: shadcn components + embeds. Unknown component tags render nothing. */
  components: Record<string, React.ComponentType<Record<string, unknown>>>;
  /**
   * Renders a `$`-bound native control (see BoundControlProps). Absent, the
   * control renders STATIC — bound attributes stripped, `disabled` — which is
   * what a render with no store behind it wants: a control that looks right
   * and cannot pretend to work.
   */
  boundControl?: React.ComponentType<BoundControlProps>;
  /**
   * Optional per-element decoration hook, called with every rendered element node (the built
   * React element, its AST node, and its AST path). The WYSIWYG editor uses it to wrap text
   * hosts with contenteditable + the render-during-edit freeze. The returned node replaces
   * the element in the tree — implementations must keep `element`'s key (identity across
   * re-renders, see `keyFor`) on whatever they return.
   */
  decorateElement?: (element: React.ReactElement, node: JsxElement, path: string) => React.ReactNode;
  /**
   * The React key for the node at a path (lib/story-ui/node-identity). Absent,
   * the path IS the key — correct for a tree rendered once, wrong for one that
   * is re-rendered after an edit: paths are positional, so removing a node
   * renumbers its siblings and React remounts every one of them and their
   * subtrees. A renderer that re-renders a document supplies this.
   */
  keyFor?: (path: string) => string;
}

/** JSX attr names → React prop names for HTML tags (agents author HTML spellings). */
const HTML_ATTR_TO_REACT: Record<string, string> = { class: 'className', for: 'htmlFor' };

/**
 * SVG is case-sensitive where HTML is not: `createElement('clippath')` is an
 * unknown element and a `viewbox` attribute is silently ignored. The interpreter
 * lowercases HTML tags (below), so canonical SVG casing must be restored for
 * both tags and the camelCase attribute set, whatever casing was authored.
 */
const SVG_TAG_CASE: Record<string, string> = Object.fromEntries(
  STORY_SVG_TAGS.filter(t => t !== t.toLowerCase()).map(t => [t.toLowerCase(), t]),
);
const SVG_CAMEL_ATTRS = [
  'viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'clipPathUnits', 'stopColor', 'stopOpacity',
  'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset',
  'strokeOpacity', 'strokeMiterlimit', 'fillOpacity', 'fillRule', 'clipRule',
  'textAnchor', 'dominantBaseline', 'textLength', 'lengthAdjust', 'baselineShift',
] as const;
const SVG_ATTR_CASE: Record<string, string> = Object.fromEntries(
  SVG_CAMEL_ATTRS.map(a => [a.toLowerCase(), a]),
);

/** Controlled props mapped to their uncontrolled forms — authored markup has no handlers. */
const CONTROLLED_TO_DEFAULT: Record<string, string> = {
  value: 'defaultValue', open: 'defaultOpen', checked: 'defaultChecked',
};
/**
 * `value` is only a CONTROLLED prop on the stateful roots (Tabs/Accordion select a value).
 * Everywhere else it's identity or data — TabsTrigger/TabsContent/AccordionItem use `value`
 * to NAME a pane, Progress uses it as the displayed number — and rewriting those to
 * `defaultValue` breaks the component. Restrict the mapping to the roots.
 *
 * …and to the HTML form controls, where it means the same thing for the opposite
 * reason: authored markup is STATIC and a document's own `<script>` drives it,
 * so `value`/`checked` are the starting state. Passed through as-is React makes
 * the field controlled with no onChange — it warns, and then refuses every
 * keystroke, which is an authored form that silently does not work.
 */
const VALUE_CONTROLLED_TAGS = immutableSet(['Tabs', 'Accordion']);
const FORM_CONTROL_TAGS = immutableSet(['input', 'textarea', 'select']);

/** Name-denied props, lowercase (mirrors lib/jsx/validate.ts DENIED_ATTRS + React internals). */
const DENIED_PROPS = immutableSet(['dangerouslysetinnerhtml', 'ref', 'key', 'srcdoc', 'is']);

/** URL-bearing props, lowercase (scheme-filtered; list-valued ones checked per entry). */

import { AST_PATH_ATTR } from './ast-path';
export { AST_PATH_ATTR } from './ast-path';

export function renderStoryNodes(nodes: JsxNode[], options: StoryInterpreterOptions): React.ReactNode {
  return nodes.map((n, i) => renderNode(n, options, String(i)));
}

function renderNode(node: JsxNode, options: StoryInterpreterOptions, path: string): React.ReactNode {
  if (node.type === 'text') return node.value;
  if (node.type === 'expression') {
    if (!node.value.static) return null;
    const v = node.value.json;
    return typeof v === 'string' || typeof v === 'number' ? String(v) : null;
  }

  const isComponent = node.isComponent;
  const Component = isComponent ? options.components[node.tag] : null;
  if (isComponent && !Component) return null; // validator rejects these; render stays safe regardless

  // A `$`-bound native control goes to the bound-control seam. Decided HERE,
  // before buildProps rewrites value→defaultValue: this is the one place the
  // element TYPE can change, and the reference must never reach the DOM.
  const bound = isComponent ? null : boundAttrs(node);
  if (bound) {
    const rest = node.attributes.filter((a) => !bound.attrs.has(a));
    const props = buildProps(rest, false, node.tag, path);
    const children = node.children.map((c, i) => renderNode(c, options, `${path}.${i}`));
    const Control = options.boundControl ?? StaticBoundControl;
    const element = React.createElement(Control, {
      key: options.keyFor?.(path) ?? path, tag: node.tag.toLowerCase() as BoundControlProps['tag'], props, bind: bound.bind,
    }, ...children);
    return options.decorateElement ? options.decorateElement(element, node, path) : element;
  }

  const props = buildProps(node.attributes, isComponent, node.tag, path);
  const children = node.children.map((c, i) => renderNode(c, options, `${path}.${i}`));
  const type = (Component ?? SVG_TAG_CASE[node.tag.toLowerCase()] ?? node.tag.toLowerCase()) as React.ElementType;
  // Void HTML elements must not receive children (React throws).
  const kids = children.length > 0 ? children : undefined;
  const element = React.createElement(type, { ...props, key: options.keyFor?.(path) ?? path }, ...(kids ?? []));
  return options.decorateElement ? options.decorateElement(element, node, path) : element;
}

/** The `$name` bindings on a native form control, or null when it has none. */
function boundAttrs(node: JsxElement): { bind: BoundControlProps['bind']; attrs: Set<JsxAttribute> } | null {
  const table = REF_ATTRS.html[node.tag.toLowerCase()];
  if (!table) return null;
  const bind: BoundControlProps['bind'] = {};
  const attrs = new Set<JsxAttribute>();
  for (const a of node.attributes) {
    const key = a.name.toLowerCase() as keyof BoundControlProps['bind'];
    if (!table[key] || !a.value.static) continue;
    const name = refName(a.value.json);
    if (!name) continue;
    bind[key] = name;
    attrs.add(a);
  }
  return attrs.size ? { bind, attrs } : null;
}

/**
 * The static rendering of a bound control: the element with its bindings
 * stripped and `disabled` set — right shape, no pretence of working. The
 * runtime supplies the live one (StoryRuntimeApp).
 */
function StaticBoundControl({ tag, props, bind, children }: BoundControlProps) {
  const bindings = Object.entries(bind).map(([k, v]) => `${k}:$${v}`).join(' ');
  return React.createElement(tag, { ...props, disabled: true, 'data-mx-bound': bindings }, ...(React.Children.toArray(children)));
}

function buildProps(
  attributes: { name: string; value: { static: boolean; json?: unknown } }[],
  isComponent: boolean,
  tag: string,
  path: string,
): Record<string, unknown> {
  const props: Record<string, unknown> = { [AST_PATH_ATTR]: path };
  for (const a of attributes) {
    if (!a.value.static) continue; // non-static values never render (validator rejects them too)
    const lower = a.name.toLowerCase();
    if (lower.startsWith('on') || DENIED_PROPS.has(lower)) continue;

    let name = HTML_ATTR_TO_REACT[a.name] ?? SVG_ATTR_CASE[lower] ?? a.name;
    let value = a.value.json;

    // Dangerous URL schemes dropped (browser-normalized check — see lib/jsx/validate.ts).
    if (typeof value === 'string') {
      const dangerous = URL_LIST_PROPS.has(lower)
        ? listHasDangerousScheme(value)
        : URL_PROPS.has(lower) && hasDangerousScheme(value);
      if (dangerous) continue;
      // SVG paint references must stay local — url(#id) only (see url-attrs.ts).
      if (SVG_PAINT_ATTRS.has(lower) && paintHasExternalUrl(value)) continue;
    }

    // `style`: authored as a CSS string (HTML idiom) or an object — React needs an object.
    if (name === 'style') {
      const style = typeof value === 'string' ? cssStringToStyleObject(value) : sanitizeStyleObject(value);
      if (style) props.style = style;
      continue;
    }

    // Objects/arrays: meaningful as component props (viz/params envelopes); dropped on HTML
    // tags, where React would stringify them into attributes to no purpose.
    if (typeof value === 'object' && value !== null && !isComponent) continue;

    // Controlled → uncontrolled on components (no handlers exist to service controlled props).
    // `value` only on the stateful roots — see VALUE_CONTROLLED_TAGS — and on
    // the HTML form controls, where an authored value is the starting state.
    const controlled = isComponent
      ? CONTROLLED_TO_DEFAULT[name] && (name !== 'value' || VALUE_CONTROLLED_TAGS.has(tag))
        // …except on a bound-control component's own binding positions
        // (REF_ATTRS.components): `checked` on <Switch> is the control's API,
        // and the adapter — not React — services it.
        && !REF_ATTRS.components[tag]?.[name]
      : CONTROLLED_TO_DEFAULT[name] && FORM_CONTROL_TAGS.has(tag.toLowerCase());
    if (controlled) {
      name = CONTROLLED_TO_DEFAULT[name];
    }

    props[name] = value;
  }
  return props;
}

/** "margin-top: 4px; color: red" → { marginTop: '4px', color: 'red' } (custom props kept as-is). */
function cssStringToStyleObject(css: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const idx = decl.indexOf(':');
    if (idx === -1) continue;
    const rawProp = decl.slice(0, idx).trim();
    const value = decl.slice(idx + 1).trim();
    if (!rawProp || !value) continue;
    const prop = rawProp.startsWith('--')
      ? rawProp
      : rawProp.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()).replace(/^(webkit|moz|ms|o)([A-Z])/, (_, p: string, c: string) => p[0].toUpperCase() + p.slice(1) + c);
    out[prop] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Style objects: plain string/number values only — never nested structures or functions-as-data. */
function sanitizeStyleObject(value: unknown): Record<string, string | number> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === 'string' || typeof v === 'number') out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}
