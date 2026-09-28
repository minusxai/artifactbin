/**
 * THE PUBLISH-TIME COMPILER (docs/phase2-architecture.md §2.1, §3, §4.1, §9; contract `CompilePage`).
 *
 * One document version (its parsed nodes, as the prepared page holds them) → Solid JSX sources:
 *
 *   skeleton   the whole story, rendered on the server WITHOUT hydration: its static parts become
 *              HTML at compile time and never reach a reader as JavaScript. Every static subtree —
 *              registered components included — is rendered by TODAY's React interpreter and kit
 *              (parity by construction) and carried as static JSX.
 *   islands    every subtree that must run in the browser (interactive kit components, data-bound
 *              embeds, `$` expressions, `<For>`, conditionals), one component per island, compiled
 *              twice by bundle.server: SSR (hydratable) for the server string, DOM (hydratable) for
 *              the reader's per-document module.
 *
 * SAFETY BY CONSTRUCTION (§9). Every author-derived string reaches the generated source through
 * `lit()` (JSON.stringify with `<`, `>`, U+2028 and U+2029 escaped). Structured author data (api
 * props, reactive expressions, row attributes) is hoisted to module constants of the form
 * `JSON.parse(<lit>)`, so it is a string literal too, never an object literal the author shapes. Tag
 * and attribute NAMES come only from the validated AST and are re-checked against a strict grammar
 * (`safeTag`/`safeAttr`); a name outside it refuses the compile. Props are computed by the
 * interpreter's own `rawBuildProps` (dangerous schemes, handlers and denied attributes dropped exactly
 * as today) and serialised by React's server renderer (`domAttrs`), so a static element's attributes
 * are byte-identical to today's render. Reactive expressions travel as data and are evaluated by the
 * runtime with lib/jsx/reactive. `codegen-safety.ts structureIndependent` is the proof.
 *
 * Ported from the prototype (scripts/probe/solid/compile.mjs). Pure and deterministic for one input.
 */
import { createElement, cloneElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseFragment } from 'parse5';
import { renderStoryNodes, rawBuildProps, wrapsControl, templateIds, type StoryInterpreterOptions } from '@/lib/story-ui/interpreter';
import { STORY_UI_COMPONENTS } from '@/lib/story-ui/registry';
import { STORY_SVG_TAGS } from '@/lib/story-ui/component-names';
import { gridCols, gridRowHeight, gridItemRect, gridRows } from '@/lib/story-ui/grid-layout';
import { IconGlyphProvider } from '@/components/kit/icon';
import { isReactiveExpression } from '@/lib/jsx/reactive';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { REF_ATTRS, carriesRef, refName, type Scalar } from '@/lib/story/dataflow';
import { resolveRefProps } from '@/lib/story/ref-data';
import { discoverSlides, MIN_SLIDES_FOR_RAIL } from '@/lib/story-runtime/slides';
import { createPreviewIdentityAllocator } from '@/lib/story-runtime/preview-identity';
import { PUBLIC_BASE_URL } from '@/lib/config';
import { RECIPES, cn } from '@/lib/islands/kit/recipes';
import type { GeneratedSources } from './codegen-safety';
import { CHART_SLOT_ATTR, EMPTY_LINK_HINTS, type CompileInput, type CompiledPage, type CompilerBuild, type IslandRef } from './contract';
import { linkHintsOf } from './links';
import { planOf } from './plan';
import { buildDocumentModules } from './bundle.server';

/* ────────────────────────────────────────────────────────────────────────────
 * Literals and names: the only doors author text has into generated code
 * ──────────────────────────────────────────────────────────────────────────── */

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
/** A JS string literal for ANY author-derived text: JSON, plus the characters JSON leaves raw that matter in HTML/JS. */
export const lit = (value: unknown): string => JSON.stringify(String(value)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replaceAll(LS, '\\u2028').replaceAll(PS, '\\u2029');
const TAG = /^[a-z][a-z0-9-]*$/i;
const ATTR = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
export const safeTag = (tag: string): string => { if (!TAG.test(tag)) throw new Error(`compile: refused tag name ${JSON.stringify(tag)}`); return tag; };
export const safeAttr = (name: string): string => { if (!ATTR.test(name)) throw new Error(`compile: refused attribute name ${JSON.stringify(name)}`); return name; };
const safeProp = (name: string): string => { if (!IDENT.test(name)) throw new Error(`compile: refused prop name ${JSON.stringify(name)}`); return name; };

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|source|track|wbr)$/;
const AST = 'data-mx-ast';
const SVG_TAG_CASE: Record<string, string> = Object.fromEntries(STORY_SVG_TAGS.filter((t) => t !== t.toLowerCase()).map((t) => [t.toLowerCase(), t]));

type Props = Record<string, unknown>;
type Attr = [string, string];

/* ────────────────────────────────────────────────────────────────────────────
 * The component table
 * ──────────────────────────────────────────────────────────────────────────── */

interface KitMeta {
  /** The kit family module (`@mx/kit/<mod>`). */
  mod: string;
  /** A component with behaviour: always an island root. */
  island?: true;
  /** API props: handed to the component; everything else is a DOM attribute. */
  api?: readonly string[];
  /** `identity`: the DOM carries only the node's identity (id, data-mx-ast) — a store adapter. */
  dom?: 'identity';
  /** Honours the GridItem it sits in. */
  grid?: true;
  /** Its children are its spec, not content. */
  noChildren?: true;
}

/** Which module each ported kit component comes from, and its API props (everything else is a DOM attribute). */
export const KIT: Readonly<Record<string, KitMeta>> = {
  Badge: { mod: 'basic', api: ['variant'] }, Alert: { mod: 'basic', api: ['variant'] }, AlertTitle: { mod: 'basic' }, AlertDescription: { mod: 'basic' },
  Card: { mod: 'basic' }, CardHeader: { mod: 'basic' }, CardTitle: { mod: 'basic' }, CardDescription: { mod: 'basic' }, CardAction: { mod: 'basic' }, CardContent: { mod: 'basic' }, CardFooter: { mod: 'basic' },
  Tabs: { mod: 'tabs', island: true, api: ['defaultValue', 'value', 'orientation', 'dir'] }, TabsList: { mod: 'tabs', api: ['variant'] }, TabsTrigger: { mod: 'tabs', api: ['value', 'disabled'] }, TabsContent: { mod: 'tabs', api: ['value'] },
  Accordion: { mod: 'accordion', island: true, api: ['type', 'collapsible', 'defaultValue', 'value', 'orientation'] }, AccordionItem: { mod: 'accordion', api: ['value', 'disabled'] }, AccordionTrigger: { mod: 'accordion' }, AccordionContent: { mod: 'accordion' },
  // Store adapters (StoryRuntimeApp): the DOM carries only the node's identity (id, data-mx-ast).
  Number: { mod: 'data', island: true, api: ['data', 'col', 'agg', 'prefix', 'suffix', 'format'], dom: 'identity' },
  Question: { mod: 'data', island: true, api: ['data', 'viz', 'title', 'height', 'recipeData'], dom: 'identity', grid: true },
  DataTable: { mod: 'data', island: true, api: ['data', 'columns', 'sort', 'height', 'sticky', 'rowKey', 'templates'], dom: 'identity', grid: true, noChildren: true },
  Files: { mod: 'files', island: true, api: ['data', 'variant', 'glyphs'], dom: 'identity' },
  Select: { mod: 'data', island: true, api: ['label', 'placeholder', 'value', 'options'] },
  Button: { mod: 'basic', api: ['variant', 'size', 'run', 'set', 'args'] },
  Mermaid: { mod: 'mermaid', island: true, api: ['code', 'title', 'colorMode'], grid: true },
  Input: { mod: 'controls', island: true, api: ['label', 'placeholder', 'value', 'type', 'min', 'max', 'step', 'aria-label'] },
  Textarea: { mod: 'controls', island: true, api: ['label', 'placeholder', 'value', 'rows', 'aria-label'] },
  Segmented: { mod: 'controls', island: true, api: ['label', 'placeholder', 'value', 'options'] },
  Slider: { mod: 'controls', island: true, api: ['label', 'value', 'min', 'max', 'step', 'format', 'prefix', 'suffix'] },
  Switch: { mod: 'controls', island: true, api: ['label', 'checked'] },
  DatePicker: { mod: 'controls', island: true, api: ['label', 'value', 'min', 'max'] },
  Collapsible: { mod: 'disclosure', island: true, api: ['defaultOpen', 'open', 'disabled'] }, CollapsibleTrigger: { mod: 'disclosure' }, CollapsibleContent: { mod: 'disclosure' },
  Popover: { mod: 'disclosure', island: true, api: ['defaultOpen'] }, PopoverTrigger: { mod: 'disclosure' }, PopoverContent: { mod: 'disclosure' }, PopoverAnchor: { mod: 'disclosure' },
  PopoverHeader: { mod: 'disclosure' }, PopoverTitle: { mod: 'disclosure' }, PopoverDescription: { mod: 'disclosure' },
  TooltipProvider: { mod: 'disclosure', island: true }, Tooltip: { mod: 'disclosure', island: true, api: ['defaultOpen'] }, TooltipTrigger: { mod: 'disclosure' }, TooltipContent: { mod: 'disclosure' },
  Avatar: { mod: 'disclosure', island: true, api: ['size'] }, AvatarImage: { mod: 'disclosure' }, AvatarFallback: { mod: 'disclosure' }, AvatarBadge: { mod: 'disclosure' }, AvatarGroup: { mod: 'disclosure' }, AvatarGroupCount: { mod: 'disclosure' },
  User: { mod: 'people', island: true, api: ['userId', 'fallback', 'avatar', 'link'] }, UserImage: { mod: 'people', island: true, api: ['userId', 'fallback', 'size', 'decorative'] }, UserHandle: { mod: 'people', island: true, api: ['userId', 'fallback', 'link'] }, SignIn: { mod: 'people', island: true },
  Dialog: { mod: 'dialog', island: true, api: ['defaultOpen'] }, DialogTrigger: { mod: 'dialog', api: ['wrapsControl', 'disabled'] }, DialogClose: { mod: 'dialog', api: ['wrapsControl', 'disabled'] }, DialogContent: { mod: 'dialog' },
};
/** The rail's miniature stubs its embeds (StoryRuntimeApp PREVIEW_REGISTRY). */
const PREVIEW_EMBEDS: Readonly<Record<string, string>> = { Question: 'chart', Number: '#', DataTable: 'table', Video: 'video' };
const PREVIEW_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: 120, border: '1px solid var(--border, rgba(128,128,128,0.35))', borderRadius: 6, background: 'color-mix(in srgb, var(--muted-foreground, gray) 6%, transparent)', font: '500 11px/1 var(--font-mono, ui-monospace, monospace)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted-foreground, graytext)' };
/** Components whose HTML the React kit renders at compile time but whose BEHAVIOUR is not ported (reported as partial). */
const PARTIAL: ReadonlySet<string> = new Set(['Iframe', 'DeckGL']);
/** Registered tags that render nothing (declarations, templates). */
const INERT: ReadonlySet<string> = new Set(['Helmet', 'Value', 'Query', 'Import', 'Mutation', 'Column']);
/** Registered components with behaviour: always an island root when ported (and the partial ones, which the browser would run). */
const ISLAND_TAGS: ReadonlySet<string> = new Set([...Object.keys(KIT).filter((tag) => KIT[tag]!.island), ...PARTIAL]);
/** The deck's framework-free behaviour chunk, by its manifest specifier. */
const DECK_BEHAVIOR = '@mx/deck';

/* ────────────────────────────────────────────────────────────────────────────
 * Static HTML → JSX
 * ──────────────────────────────────────────────────────────────────────────── */

/** React props → the element's attributes exactly as React's server renderer writes them. */
export function domAttrs(tag: string, props: Props): Attr[] {
  const { children: _children, dangerouslySetInnerHTML: _html, ...rest } = props;
  // React 19 writes resource hints (`<link rel=preload as=image>`) BEFORE an <img>; the element's own tag is the one named.
  const html = renderToStaticMarkup(createElement(tag, rest)).replace(/^(<link\b[^>]*>)+/, '');
  const start = html.slice(0, html.indexOf('>') + 1);
  const attrs: Attr[] = [];
  for (const m of start.matchAll(/\s([^\s=/>]+)(?:="([^"]*)")?/g)) {
    attrs.push([m[1]!, (m[2] ?? '').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')]);
  }
  return attrs;
}
const attrsJsx = (attrs: Attr[]): string => attrs.map(([n, v]) => ` ${safeAttr(n)}={${lit(v)}}`).join('');

interface P5Node { nodeName: string; tagName?: string; value?: string; attrs?: Array<{ name: string; value: string; prefix?: string }>; childNodes?: P5Node[]; content?: { childNodes: P5Node[] } }

/** Static HTML (from React's server renderer) → Solid JSX with every value a string literal. */
export function htmlToJsx(html: string, svg = false): string {
  const frag = parseFragment(svg ? `<svg>${html}</svg>` : html) as unknown as P5Node;
  const nodes = svg ? frag.childNodes?.[0]?.childNodes ?? [] : frag.childNodes ?? [];
  const walk = (n: P5Node): string => {
    if (n.nodeName === '#text') return n.value ? `{${lit(n.value)}}` : '';
    if (n.nodeName === '#comment' || !n.tagName) return '';
    const tag = safeTag(n.tagName);
    const attrs = (n.attrs ?? []).map((a) => ` ${safeAttr(a.prefix ? `${a.prefix}:${a.name}` : a.name)}={${lit(a.value)}}`).join('');
    const kids = ((n.tagName === 'template' ? n.content?.childNodes : n.childNodes) ?? []).map(walk).join('');
    return VOID.test(tag) ? `<${tag}${attrs} />` : `<${tag}${attrs}>${kids}</${tag}>`;
  };
  return nodes.map(walk).join('');
}

/* ────────────────────────────────────────────────────────────────────────────
 * Which nodes need the browser
 * ──────────────────────────────────────────────────────────────────────────── */

const isElement = (node: JsxNode): node is JsxElement => node.type === 'element';

/** Does this node itself need the browser? */
function selfDynamic(node: JsxNode): boolean {
  if (node.type === 'text') return false;
  if (node.type === 'expression') return !node.value.static;
  if (node.control) return node.control.kind !== 'fragment';
  if (node.tag === 'For') return true;
  if (ISLAND_TAGS.has(node.tag)) return true;
  if (node.attributes.some((a) => !a.value.static)) return true;
  if (node.attributes.some((a) => ['run', 'set', 'args'].includes(a.name))) return true;
  const refs = node.isComponent ? REF_ATTRS.components[node.tag] : REF_ATTRS.html[node.tag.toLowerCase()];
  if (refs && node.attributes.some((a) => refs[a.name.toLowerCase()] && a.value.static && (refName(a.value.json) || carriesRef(a.value.json)))) return true;
  return false;
}

/** Does this subtree read the document's data (a `$` binding, a reactive expression, a row)? */
function readsDataNode(node: JsxNode): boolean {
  if (node.type === 'text') return false;
  if (node.type === 'expression') return !node.value.static;
  if (node.control && node.control.kind !== 'fragment') return true;
  if (node.tag === 'For') return true;
  if (node.attributes.some((a) => !a.value.static || refName(a.value.json) !== null || carriesRef(a.value.json))) return true;
  return node.children.some(readsDataNode);
}

const isTableParts = (node: JsxElement): boolean => node.children.every((c) => (c.type === 'text' ? !c.value.trim() : c.type === 'element' && ['tr', 'td', 'th'].includes(c.tag)));

/* ────────────────────────────────────────────────────────────────────────────
 * The generator
 * ──────────────────────────────────────────────────────────────────────────── */

type Decorate = NonNullable<StoryInterpreterOptions['decorateElement']>;
type Mode = 'static' | 'island';
interface IslandBuild { id: number; path: string; source: string; kit: Set<string>; readsData: boolean }
interface Ctx {
  /** The JS name of the row in scope (inside a `<For>`), and its scope's. */
  row: string | null;
  scope?: string;
  svg?: boolean;
  grid?: { cols: number; flow: boolean };
  /** The deck rail's thumbnail decoration. */
  preview?: Decorate;
  /** The island being emitted, for its kit accounting. */
  island?: IslandBuild;
}

/** What one generation produced: the sources and what they used. */
export interface Generated extends GeneratedSources {
  islandRefs: IslandRef[];
  kit: { skeleton: string[]; islands: string[] };
  reactStatic: string[];
  unported: string[];
  partial: string[];
  behaviors: string[];
}

/** One version's facts the generator reads (CompileInput without the build). */
type GenerateInput = Omit<CompileInput, 'build'>;

export function generate(input: GenerateInput): Generated {
  const refData = input.refData ?? {};
  const nodes = input.nodes ?? [];
  const islands: IslandBuild[] = [];
  const reactStatic = new Set<string>();
  const partial = new Set<string>();
  const unported = new Set<string>();
  const kitUsed = { skeleton: new Set<string>(), islands: new Set<string>() };
  const needs = new WeakMap<JsxNode, boolean>();
  const needsBrowser = (node: JsxNode): boolean => {
    const known = needs.get(node);
    if (known !== undefined) return known;
    const value = selfDynamic(node) || (isElement(node) && node.children.some(needsBrowser));
    needs.set(node, value);
    return value;
  };
  /** An element whose dynamic child cannot be its own island root (text, expression, control, a wrapper-less For) must be the island itself. */
  const mustPromote = (node: JsxElement): boolean =>
    node.children.some((c) => needsBrowser(c) && (!isElement(c) || !!c.control || (c.tag === 'For' && isTableParts(c))));

  // Structured author data never becomes an object literal: each value is a module constant parsed
  // from a string literal — one per emission site, never shared by content, so the module's shape
  // depends on the tree alone.
  const data: string[] = [];
  const json = (value: unknown): string => {
    data.push(JSON.stringify(value === undefined ? null : value));
    return `$d${data.length - 1}`;
  };
  const useKit = (tag: string, mode: Mode, ctx: Ctx): void => {
    (mode === 'static' ? kitUsed.skeleton : kitUsed.islands).add(tag);
    ctx.island?.kit.add(tag);
  };

  /** Render one static subtree with the React kit (the interpreter, its registry, the glyph provider), with its real AST paths. */
  function reactStaticJsx(node: JsxElement, path: string, ctx: Ctx): string {
    const prefix = path.split('.');
    // The runtime's own decoration (StoryRuntimeApp decorateElement): `ref:` sources resolved, then the path rebased.
    const rebase: Decorate = (element, n, p) => {
      const patch = resolveRefProps(n, element.props as Props, refData);
      return cloneElement(element as ReactElement<Props>, { ...(patch ?? {}), [AST]: [...prefix, ...p.split('.').slice(1)].join('.') });
    };
    const decorate: Decorate = ctx.preview ? (element, n, p) => ctx.preview!(rebase(element, n, p) as ReactElement, n, p) : rebase;
    // React's hoisted image preloads are dropped: a compiled page names its preloads in the head.
    const html = renderToStaticMarkup(createElement(IconGlyphProvider, { value: input.glyphs ?? {} }, renderStoryNodes([node], { values: {}, components: STORY_UI_COMPONENTS, decorateElement: decorate })))
      .replace(/<link rel="preload"[^>]*>/g, '');
    return htmlToJsx(html, !!ctx.svg);
  }

  /** Emit one node as a JSX child. */
  function emit(node: JsxNode, path: string, mode: Mode, ctx: Ctx): string {
    if (node.type === 'text') {
      if (ctx.row && /\{\s*\$_row\./.test(node.value)) return `{rt.sub(${lit(node.value)}, ${ctx.row})}`;
      return node.value === '' ? '' : `{${lit(node.value)}}`;
    }
    if (node.type === 'expression') {
      if (!node.value.static) {
        if (isReactiveExpression(node.value.reactive)) return `{rt.text(${json(node.value.reactive)}, ${ctx.row ?? 'undefined'})}`;
        const field = ctx.row ? /^\s*\$_row\.([A-Za-z_]\w*)\s*$/.exec(node.source)?.[1] : null;
        return field ? `{String(${ctx.row}[${lit(field)}] ?? '')}` : '';
      }
      const v = node.value.json;
      return typeof v === 'string' || typeof v === 'number' ? `{${lit(String(v))}}` : '';
    }
    if (node.control) {
      if (node.control.kind === 'fragment') return `<>${node.children.map((c, i) => emit(c, `${path}.${i}`, mode, ctx)).join('')}</>`;
      if (!isReactiveExpression(node.control.test) || node.children.length !== 2) return '';
      const yes = emit(node.children[0]!, `${path}.0`, mode, ctx);
      const no = emit(node.children[1]!, `${path}.1`, mode, ctx);
      return `<rt.When test={${json(node.control.test)}} row={${ctx.row ?? 'undefined'}}${node.control.kind === 'conditional' ? ` fallback={<>${no}</>}` : ''}>{<>${yes}</>}</rt.When>`;
    }
    if (INERT.has(node.tag)) return '';
    // An island root in the skeleton: rendered by its own island component, spliced in by the server.
    if (mode === 'static' && !ctx.preview && !PARTIAL.has(node.tag) && needsBrowser(node) && (selfDynamic(node) || mustPromote(node))) {
      const island: IslandBuild = { id: islands.length, path, source: '', kit: new Set(), readsData: !!input.flow && readsDataNode(node) };
      islands.push(island);
      island.source = emitElement(node, path, 'island', { row: null, svg: !!ctx.svg, grid: ctx.grid, island });
      return `<mx-slot data-i={${lit(String(island.id))}}></mx-slot>`;
    }
    return emitElement(node, path, mode, ctx);
  }

  function emitElement(node: JsxElement, path: string, mode: Mode, ctx: Ctx): string {
    const children = (inner: Ctx = ctx): string => node.children.map((c, i) => emit(c, `${path}.${i}`, mode, inner)).join('');
    if (node.tag === 'For') return emitFor(node, path, ctx);
    if (node.tag === 'Grid' || node.tag === 'GridItem') return emitGrid(node, path, mode, ctx);
    if (ctx.preview && PREVIEW_EMBEDS[node.tag]) return `<div${attrsJsx(domAttrs('div', { style: PREVIEW_STYLE }))}>{${lit(PREVIEW_EMBEDS[node.tag])}}</div>`;
    if (node.isComponent) {
      const meta = KIT[node.tag];
      // A STATIC registered component: today's React kit renders it AT COMPILE TIME (parity by
      // construction) and its HTML becomes static JSX — in the skeleton whether or not the Solid kit
      // ports it, inside an island when it has no port. Nothing of it ever reaches a reader as code.
      const staticHere = !ctx.row && !!STORY_UI_COMPONENTS[node.tag] && (!needsBrowser(node) || PARTIAL.has(node.tag));
      if (staticHere && (!meta || mode === 'static')) { (PARTIAL.has(node.tag) ? partial : reactStatic).add(node.tag); return reactStaticJsx(node, path, ctx); }
      if (!meta) { unported.add(node.tag); return `<div data-mx-unported={${lit(node.tag)}} data-mx-ast={${lit(path)}}></div>`; }
      useKit(node.tag, mode, ctx);
      const props = rawBuildProps(node.attributes, true, node.tag, path, undefined, {});
      // Decided here, never read from the author (interpreter BUTTON_TRIGGERS).
      if (node.tag === 'DialogTrigger' || node.tag === 'DialogClose') props.wrapsControl = wrapsControl(node);
      // The runtime registry hands Mermaid the document's colour mode (StoryRuntimeApp RUNTIME_REGISTRY).
      if (node.tag === 'Mermaid') props.colorMode = input.colorMode ?? 'light';
      // <Column> children ARE the column spec (interpreter DataTable templates → parseColumnSpecs(templates.map(t => t.props))).
      if (node.tag === 'DataTable') {
        const cols = node.children.flatMap((c, i) => (isElement(c) && c.tag === 'Column' ? [rawBuildProps(c.attributes, true, 'Column', `${path}.${i}`, undefined, {})] : []));
        if (cols.length) {
          props.columns = cols.map(({ [AST]: _ast, ...rest }) => rest);
          props.templates = cols.map((c) => ({ col: c.col, id: typeof c.id === 'string' ? c.id : undefined, path: c[AST] }));
        }
      }
      if (node.tag === 'Files') props.glyphs = input.glyphs ?? {};
      const viz = props.viz as { recipe?: unknown } | undefined;
      if (node.tag === 'Question' && typeof viz?.recipe === 'string' && viz.recipe.startsWith('ref:')) props.recipeData = refData[viz.recipe.slice(4)] ?? null;
      const api: Props = Object.fromEntries((meta.api ?? []).filter((k) => props[k] !== undefined).map((k) => [k, props[k]]));
      // Class strings come from the recipes index AT COMPILE TIME: readers never download cva or tailwind-merge.
      const recipe = RECIPES[node.tag];
      // In a fixed grid's tile the tile owns the size (components/kit/grid GridItemContext): the recipe and the port both know.
      const inGrid = !!(meta.grid && ctx.grid && !ctx.grid.flow);
      const cls = meta.dom === 'identity' ? null : recipe ? cn(recipe({ ...props, ...(inGrid ? { inGridItem: true } : {}) })) : typeof props.className === 'string' ? props.className : null;
      let dom: Props = { ...props };
      for (const k of [...(meta.api ?? []), 'className']) delete dom[k];
      if (ctx.preview) dom = (ctx.preview(createElement('div', dom), node, path) as ReactElement<Props>).props;
      if (meta.dom === 'identity') dom = Object.fromEntries(Object.entries(dom).filter(([k]) => k === 'id' || k === AST));
      // A `<Question>`'s chart box: the assembler puts the snapshot's drawing inside it (contract CHART_SLOT_ATTR).
      if (node.tag === 'Question') dom[CHART_SLOT_ATTR] = typeof dom.id === 'string' && dom.id ? dom.id : path;
      if (inGrid) api.inGridItem = true;
      const attrs = domAttrs('div', dom).filter(([n]) => n !== 'class');
      const apiJsx = Object.entries(api).map(([k, v]) => ` ${safeAttr(k)}={${typeof v === 'string' ? lit(v) : json(v)}}`).join('');
      const clsJsx = cls ? ` class={${lit(cls)}}` : '';
      const tag = safeTag(node.tag);
      // A row action writes with its row (interpreter rowAction → StoryRuntimeApp RuntimeRowAction).
      const rowJsx = node.tag === 'Button' && (api.run !== undefined || api.set !== undefined) ? ` row={${ctx.row}} rowScope={${ctx.scope}}` : '';
      if (ctx.row) return `<${tag}${apiJsx}${rowJsx}${clsJsx} {...rt.rowAttrs(${json(Object.fromEntries(attrs))}, ${ctx.row}, ${ctx.scope})}>${children()}</${tag}>`;
      return `<${tag}${apiJsx}${clsJsx}${attrsJsx(attrs)}>${meta.noChildren ? '' : children()}</${tag}>`;
    }
    const lower = node.tag.toLowerCase();
    const tag = safeTag(SVG_TAG_CASE[lower] ?? lower);
    // A `$`-bound native form control (interpreter boundAttrs → StoryRuntimeApp NativeBoundControl).
    const boundTable = ['input', 'select', 'textarea'].includes(lower) ? REF_ATTRS.html[lower] : null;
    const boundAttrs = boundTable ? node.attributes.filter((a) => boundTable[a.name.toLowerCase()] && a.value.static && refName(a.value.json)) : [];
    if (boundAttrs.length) {
      useKit('BoundNative', mode, ctx);
      const bind = Object.fromEntries(boundAttrs.map((a) => [a.name.toLowerCase(), refName(a.value.static ? a.value.json : null)]));
      const props = rawBuildProps(node.attributes.filter((a) => !boundAttrs.includes(a)), false, node.tag, path, undefined, {});
      return `<BoundNative tag={${lit(lower)}} bind={${json(bind)}}${attrsJsx(domAttrs(tag, props))}>${children()}</BoundNative>`;
    }
    let props = rawBuildProps(node.attributes, false, node.tag, path, undefined, {});
    const patch = resolveRefProps(node, props, refData);
    if (patch) props = { ...props, ...patch };
    if (ctx.preview) props = (ctx.preview(createElement(tag, props), node, path) as ReactElement<Props>).props;
    const inner = lower === 'svg' ? { ...ctx, svg: true } : ctx;
    const attrs = domAttrs(tag, props);
    const open = ctx.row ? `<${tag} {...rt.rowAttrs(${json(Object.fromEntries(attrs))}, ${ctx.row}, ${ctx.scope})}>` : `<${tag}${attrsJsx(attrs)}>`;
    if (VOID.test(lower)) return open.replace(/>$/, ' />');
    return `${open}${children(inner)}</${tag}>`;
  }

  /** Grid/GridItem are compile-time macros: layout arithmetic done here, plain HTML out (components/kit/grid). */
  function emitGrid(node: JsxElement, path: string, mode: Mode, ctx: Ctx): string {
    const props = rawBuildProps(node.attributes, true, node.tag, path, undefined, {});
    const { className, style, cols, rowHeight, mode: gridMode, x, y, w, h, minHeight, editing: _editing, ...rest } = props;
    const styleObject = (style && typeof style === 'object' ? style : {}) as Props;
    const classString = typeof className === 'string' ? className : undefined;
    if (node.tag === 'Grid') {
      const nCols = gridCols(cols);
      const rh = gridRowHeight(rowHeight);
      const items = node.children.flatMap((c, i) => (isElement(c) && c.tag === 'GridItem' ? [[c, i] as const] : []));
      const rows = gridRows(items.map(([c]) => gridItemRect(rawBuildProps(c.attributes, true, 'GridItem', '', undefined, {}) as Parameters<typeof gridItemRect>[0], nCols)));
      const flow = gridMode === 'flow';
      const outer = domAttrs('div', { className: cn('@container w-full', classString), style: { ...styleObject, '--g-cols': String(nCols), '--g-rh': `${rh}px`, '--g-rows': String(rows) }, ...rest });
      const inner = flow ? 'grid w-full grid-cols-[repeat(var(--g-cols),minmax(0,1fr))] items-start @max-2xl:grid-cols-1' : 'relative w-full h-[calc(var(--g-rows)*var(--g-rh))] @max-2xl:h-auto';
      const kids = items.map(([c, i]) => emit(c, `${path}.${i}`, mode, { ...ctx, grid: { cols: nCols, flow } })).join('');
      return `<div${attrsJsx(outer)}><div class={${lit(inner)}}>${kids}</div></div>`;
    }
    const flow = ctx.grid?.flow ?? false;
    const nCols = ctx.grid?.cols ?? 12;
    const rect = gridItemRect({ x, y, w, h } as Parameters<typeof gridItemRect>[0], nCols);
    const cls = cn(flow ? 'min-w-0 p-[3px] col-span-[var(--gi-w)] min-h-[var(--gi-min-h)] @max-2xl:col-span-1' : 'overflow-hidden p-[3px]', flow ? 'relative' : 'absolute left-[calc(var(--gi-x)/var(--g-cols)*100%)] top-[calc(var(--gi-y)*var(--g-rh))] w-[calc(var(--gi-w)/var(--g-cols)*100%)] h-[calc(var(--gi-h)*var(--g-rh))] @max-2xl:static @max-2xl:w-full', classString);
    const minH = flow && typeof minHeight === 'number' && Number.isFinite(minHeight) ? Math.max(0, Math.min(10000, minHeight)) : 0;
    const attrs = domAttrs('div', { className: cls, style: { ...styleObject, '--gi-min-h': `${minH}px`, '--gi-x': String(rect.x), '--gi-y': String(rect.y), '--gi-w': String(rect.w), '--gi-h': String(rect.h) }, ...rest });
    return `<div${attrsJsx(attrs)}>${node.children.map((c, i) => emit(c, `${path}.${i}`, mode, ctx)).join('')}</div>`;
  }

  function emitFor(node: JsxElement, path: string, ctx: Ctx): string {
    const each = node.attributes.find((a) => a.name === 'each');
    const name = each && !each.value.static && each.value.reactive?.kind === 'signal' ? each.value.reactive.name : null;
    if (!name) return `<div role="alert">{"For requires each={$table}"}</div>`;
    const keyBy = node.attributes.find((a) => a.name === 'keyBy')?.value;
    const owner = node.attributes.find((a) => a.name === 'id')?.value;
    const wrapper = rawBuildProps(node.attributes.filter((a) => a.name !== 'each' && a.name !== 'keyBy'), true, node.tag, path, undefined, {});
    const ownerId = owner?.static && typeof owner.json === 'string' ? owner.json : '';
    const svg = !!ctx.svg;
    const style = svg ? {} : { style: { minHeight: 1, ...((wrapper.style && typeof wrapper.style === 'object' ? wrapper.style : {}) as Props) } };
    const { className, ...rest } = wrapper;
    // The wrapper's style goes to rt.Repeat as `attr:style`: its spread then SETS the attribute (skipped while
    // hydrating), keeping React's served `min-height:1px` byte for byte. A spread `style` would be rewritten
    // through the CSSOM (`min-height: 1px;`) during hydration, which today's page never does.
    const attrs = domAttrs(svg ? 'g' : 'div', { ...rest, ...(className ? { className } : {}), ...style, id: ownerId || undefined })
      .map(([n, v]): Attr => [n === 'style' ? 'attr:style' : n, v]);
    const suffix = path.replace(/\./g, '_');
    const row = `row${suffix}`;
    const scope = `scope${suffix}`;
    const body = node.children.map((c, i) => emit(c, `${path}.${i}`, 'island', { ...ctx, row, scope })).join('');
    const keyJsx = keyBy?.static ? ` keyBy={${lit(keyBy.json)}}` : '';
    return `<rt.Repeat name={${lit(name)}}${keyJsx} owner={${lit(ownerId)}} ids={${json([...templateIds(node.children)])}}${isTableParts(node) ? ' tableParts={true}' : ''}${svg ? ' svg={true}' : ''}${attrsJsx(attrs)}>{(${row}, ${scope}) => <>${body}</>}</rt.Repeat>`;
  }

  // The column wrapper the runtime always draws (StoryRuntimeApp: `.mx-doc`).
  const body = nodes.map((n, i) => emit(n, String(i), 'static', { row: null })).join('');
  // A DECK's chrome (StoryRuntimeApp SlideRail/PresentBar): static HTML at compile time, thumbnails
  // included; its behaviour is the framework-free `@mx/deck` chunk.
  const slides = input.chrome !== false ? discoverSlides(nodes) : [];
  const deck = slides.length >= MIN_SLIDES_FOR_RAIL;
  let root = `<div class="mx-doc">${body}</div>`;
  if (deck) {
    const allocate = createPreviewIdentityAllocator(nodes, '_R_1_');
    const rail = slides.map((slide) => {
      const decorate = allocate([slide.node], slide.path);
      const thumb = emit(slide.node, '0', 'static', { row: null, preview: decorate });
      return `<button type="button" class="mx-rail-row" aria-label={${lit(`Go to slide ${slide.index + 1}: ${slide.title}`)}} aria-current={${lit(String(slide.index === 0))}}><span class="mx-rail-label"><span class="mx-rail-index">{${lit(String(slide.index + 1))}}</span><span class="mx-rail-title">{${lit(slide.title)}}</span></span><span class="mx-rail-thumb" aria-hidden="true"><div style="--mx-vh:800px">${thumb}</div></span></button>`;
    }).join('');
    root = `<div class="mx-deck"><nav class="mx-rail" aria-label="Slides">${rail}</nav>${root}<div class="mx-present" aria-label="Slide controls"><button type="button" aria-label="Previous slide">{"‹"}</button><span class="mx-present-count" aria-label="Slide position">{${lit(`1 / ${slides.length}`)}}</span><button type="button" aria-label="Next slide">{"›"}</button><button type="button" aria-label="Present">{"present"}</button></div></div>`;
  }

  const kitImports = (set: Set<string>): string => {
    const byMod: Record<string, string[]> = {};
    for (const tag of set) (byMod[tag === 'BoundNative' ? 'controls' : KIT[tag]!.mod] ??= []).push(tag);
    return Object.entries(byMod).sort(([a], [b]) => a.localeCompare(b)).map(([mod, tags]) => `import { ${tags.sort().map(safeProp).join(', ')} } from ${lit(`@mx/kit/${safeTag(mod)}`)};\n`).join('');
  };
  const dataConsts = data.map((text, i) => `const $d${i} = JSON.parse(${lit(text)});\n`).join('');
  // The skeleton imports only what it renders with; the islands module always carries the runtime.
  const skeleton = `${kitImports(kitUsed.skeleton)}${dataConsts}export default function Skeleton() { return ${root}; }\n`;
  const islandsSource = `import * as rt from '@mx/rt';\n${kitImports(kitUsed.islands)}${dataConsts}`
    + islands.map((isl) => `export function I${isl.id}() { return ${isl.source}; }\n`).join('')
    + `export const ISLANDS = [${islands.map((isl) => `[${lit(`s${isl.id}-`)}, I${isl.id}]`).join(', ')}];\n`;
  return {
    skeleton,
    islands: islandsSource,
    islandRefs: islands.map((isl) => ({ renderId: `s${isl.id}-`, path: isl.path, kit: [...isl.kit].sort(), readsData: isl.readsData })),
    kit: { skeleton: [...kitUsed.skeleton].sort(), islands: [...kitUsed.islands].sort() },
    reactStatic: [...reactStatic].sort(),
    unported: [...unported].sort(),
    partial: [...partial].sort(),
    behaviors: deck ? [DECK_BEHAVIOR] : [],
  };
}

/* ────────────────────────────────────────────────────────────────────────────
 * The two entry points
 * ──────────────────────────────────────────────────────────────────────────── */

/** The generated Solid sources for one version (the safety harness's view of the compiler). Rejects a malformed name. */
export async function compileSources(input: CompileInput): Promise<GeneratedSources> {
  const { skeleton, islands } = generate(input);
  return { skeleton, islands };
}

/** The declared state: every scalar at its default (what `CompiledPage.html` renders). */
export function declaredValues(flow: CompileInput['flow']): Record<string, Scalar> {
  return Object.fromEntries((flow?.values ?? []).filter((v) => v.kind === 'scalar').map((v) => [v.name, v.default]));
}

/** The deployment's own origins, for link hints (a same-deployment absolute link is a hint). */
const deploymentOrigins = (): string[] => { try { return [new URL(PUBLIC_BASE_URL).origin]; } catch { return []; } };

/**
 * `compilePage` (contract `CompilePage`). A version that needs an unported interactive component
 * comes back with `unported` non-empty and nothing built: the caller records a `CompileFailure`.
 * A behaviour the shared build does not carry refuses the compile (a throw), never a silent drop.
 */
export async function compilePage(input: CompileInput, build: CompilerBuild): Promise<CompiledPage> {
  if (input.build !== build.id) throw new Error(`compile: input is for build ${input.build}, not ${build.id}`);
  const generated = generate(input);
  const unknown = generated.behaviors.filter((b) => !build.manifest[b]);
  if (unknown.length) throw new Error(`compile: the island build carries no ${unknown.join(', ')}`);
  // Classified with the anonymous reader's admission the caller decided (snapshots.server
  // anonymousAccessFacts), so this is the plan snapshots key on; without it no dataset is admitted and
  // every query that reads one is `viewer` — never a private answer in a guest snapshot.
  const plan = input.flow ? planOf(input.flow, input.access ?? { datasets: {} }) : null;
  const links = input.nodes.length ? linkHintsOf(input.nodes, { origins: deploymentOrigins() }) : EMPTY_LINK_HINTS;
  const base = {
    build: build.id, islands: generated.islandRefs, behaviors: generated.behaviors, plan, links,
    kit: generated.kit, reactStatic: generated.reactStatic, unported: generated.unported, partial: generated.partial,
  };
  if (generated.unported.length) return { ...base, html: '', module: null, ssr: null };
  const built = await buildDocumentModules(generated, { build, flow: input.flow, values: declaredValues(input.flow) });
  return { ...base, html: built.html, module: built.module, ssr: built.ssr };
}
