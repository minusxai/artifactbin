/** Framework-free author AST props and names shared by the React editor and Solid compiler. */
import type { JsxAttribute, JsxElement, JsxNode } from '@/lib/jsx';
import { DENIED_JSX_ATTRS } from '@/lib/jsx/denied-attrs';
import { evaluateReactive, isReactiveExpression, REACTIVE_BOOLEAN_PROPS } from '@/lib/jsx/reactive';
import { immutableSet } from '@/lib/utils/immutable-collections';
import { hasDangerousScheme, listHasDangerousScheme } from '@/lib/jsx/validate';
import { URL_ATTRS as URL_PROPS, URL_LIST_ATTRS as URL_LIST_PROPS, SVG_PAINT_ATTRS, paintHasExternalUrl } from '@/lib/jsx/url-attrs';
import { ARGS_ATTR, bindingMap, REF_ATTRS, rowBound, SET_ATTR } from '@/lib/story/data/dataflow';
import { substituteRow } from '@/lib/story/data/row-scope';
import { AST_PATH_ATTR } from './ast-path';

/** JSX attr names → React prop names for HTML tags (agents author HTML spellings). */
const HTML_ATTR_TO_REACT: Record<string, string> = { class: 'className', for: 'htmlFor' };

/** Canonical case for SVG props accepted by both renderers. */
const SVG_CAMEL_ATTRS = [
  'viewBox', 'preserveAspectRatio', 'gradientUnits', 'gradientTransform', 'spreadMethod',
  'clipPathUnits', 'stopColor', 'stopOpacity',
  'strokeWidth', 'strokeLinecap', 'strokeLinejoin', 'strokeDasharray', 'strokeDashoffset',
  'strokeOpacity', 'strokeMiterlimit', 'fillOpacity', 'fillRule', 'clipRule',
  'textAnchor', 'dominantBaseline', 'textLength', 'lengthAdjust', 'baselineShift',
] as const;
export const SVG_ATTR_CASE: Record<string, string> = Object.fromEntries(
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
export const FORM_CONTROL_TAGS = immutableSet(['input', 'textarea', 'select']);

/** Name-denied props, lowercase — the same set the save-time gate uses (lib/jsx/denied-attrs.ts). */
const DENIED_PROPS = DENIED_JSX_ATTRS;

/**
 * The story components that render a plain `<button>` around whatever the
 * author put in them. The other triggers (Tabs/Accordion/Collapsible/Popover)
 * carry `role`/`aria-expanded`/`aria-controls` on that button and are left
 * alone: they are not interchangeable with a span.
 */
export const BUTTON_TRIGGERS = new Set(['DialogTrigger', 'DialogClose']);

/**
 * The tags that draw something INTERACTIVE, which the HTML content model
 * forbids inside a `<button>`: the browser closes the button early and promotes
 * the inner control to its sibling, so the parsed page and React's tree
 * disagree and hydration fails with error 418 (components/kit/dialog
 * DialogTrigger; the same parse-time reshaping as a `<div>` in a `<tbody>`).
 */
const INTERACTIVE_TAGS = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'Button', 'Select', 'Slider', 'DatePicker', 'Segmented', 'Switch']);

/** Does this trigger already hold a control of its own — at any depth? */
export function wrapsControl(node: JsxElement): boolean {
  return node.children.some((child) => child.type === 'element'
    && (INTERACTIVE_TAGS.has(child.tag) || INTERACTIVE_TAGS.has(child.tag.toLowerCase()) || wrapsControl(child)));
}

export function rawBuildProps(
  attributes: JsxAttribute[],
  isComponent: boolean,
  tag: string,
  path: string,
  row?: Record<string, unknown>,
  values: Record<string, unknown> = {},
): Record<string, unknown> {
  const props: Record<string, unknown> = { [AST_PATH_ATTR]: path };
  for (const a of attributes) {
    const lower = a.name.toLowerCase();
    if (lower.startsWith('on') || DENIED_PROPS.has(lower)) continue;
    if (!a.value.static) {
      if (REACTIVE_BOOLEAN_PROPS.has(a.name) && isReactiveExpression(a.value.reactive)) {
        props[a.name] = Boolean(evaluateReactive(a.value.reactive, values, row));
      }
      continue;
    }

    // `set=` / `args=`: a component receives its binding map, with any row field already read.
    if (isComponent && (a.name === SET_ATTR || a.name === ARGS_ATTR)) {
      const map = bindingMap(a.value.json);
      if (map) props[a.name] = row ? rowBound(map, row) : map;
      continue;
    }
    let name = HTML_ATTR_TO_REACT[a.name] ?? SVG_ATTR_CASE[lower] ?? a.name;
    let value = row && lower !== 'id' ? substituteRow(a.value.json, row) : a.value.json;

    // Dangerous URL schemes dropped (browser-normalized check — see lib/jsx/validate.ts).
    if (typeof value === 'string') {
      const dangerous = URL_LIST_PROPS.has(lower)
        ? listHasDangerousScheme(value, lower)
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
    if (controlled && !row) {
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

export function templateIds(nodes: JsxNode[]): Set<string> {
  const ids = new Set<string>();
  const visit = (nodes: JsxNode[]) => nodes.forEach(node => { if(node.type === 'element') { const id = node.attributes.find(a=>a.name==='id')?.value; if(id?.static && typeof id.json==='string') ids.add(id.json); visit(node.children); } });
  visit(nodes); return ids;
}
