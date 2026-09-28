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
import { IconGlyphProvider, ICON_BASE_CLASS } from '@/components/kit/icon';
import { buildGlyphMap } from '@/lib/story/icon-glyphs';
import { isReactiveExpression, REACTIVE_BOOLEAN_PROPS } from '@/lib/jsx/reactive';
import { shellRest } from '@/components/kit/controls';
import { parseRowRef } from '@/lib/story/row-scope';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { REF_ATTRS, carriesRef, refName, type Scalar } from '@/lib/story/dataflow';
import { resolveRefProps } from '@/lib/story/ref-data';
import { substituteRow } from '@/lib/story/row-scope';
import { discoverSlides, MIN_SLIDES_FOR_RAIL } from '@/lib/story-runtime/slides';
import { discoverOutline, hasOutline } from '@/lib/story-runtime/outline';
import { createPreviewIdentityAllocator } from '@/lib/story-runtime/preview-identity';
import { PUBLIC_BASE_URL } from '@/lib/config';
import { compileManagedIframe } from '@/lib/story/managed-iframe';
import { RECIPES, cn } from '@/lib/islands/kit/recipes';
import { peopleClasses } from '@/lib/islands/kit/recipes/people';
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
  /** `identity`: the DOM carries only the node's identity (id, data-mx-ast) — a store adapter; `box`: the identity and the author's class. */
  dom?: 'identity' | 'box';
  /** Honours the GridItem it sits in. */
  grid?: true;
  /** Its children are its spec, not content. */
  noChildren?: true;
}

/** Which module each ported kit component comes from, and its API props (everything else is a DOM attribute). */
export const KIT: Readonly<Record<string, KitMeta>> = {
  Badge: { mod: 'basic', api: ['variant'] }, Alert: { mod: 'basic', api: ['variant'] }, AlertTitle: { mod: 'basic' }, AlertDescription: { mod: 'basic' },
  Progress: { mod: 'basic', api: ['value'] }, Icon: { mod: 'basic', api: ['name', 'glyphs', 'catalogUrl'] },
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
  // A person's class depends on whom it resolves to in the browser (a guest's fallback, a card): every state's class
  // is evaluated here (recipes/people peopleClasses) and handed to the port as `classes`.
  User: { mod: 'people', island: true, api: ['userId', 'fallback', 'avatar', 'link', 'classes'] }, UserImage: { mod: 'people', island: true, api: ['userId', 'fallback', 'size', 'decorative', 'classes'] }, UserHandle: { mod: 'people', island: true, api: ['userId', 'fallback', 'link', 'classes'] }, SignIn: { mod: 'people', island: true },
  // Embeds with behaviour in a lazy chunk (lib/islands/kit/embed, their own family): today's managed frame and map.
  Iframe: { mod: 'embed', island: true, api: ['title', 'height', 'compiled'], dom: 'box', noChildren: true },
  DeckGL: { mod: 'embed', island: true, api: ['data', 'layers', 'basemap', 'initialViewState', 'tooltip', 'legend', 'title', 'height', 'colorMode'], dom: 'box', grid: true },
  Dialog: { mod: 'dialog', island: true, api: ['defaultOpen', 'open'] }, DialogTrigger: { mod: 'dialog', api: ['wrapsControl', 'disabled'] }, DialogClose: { mod: 'dialog', api: ['wrapsControl', 'disabled'] }, DialogContent: { mod: 'dialog', api: ['run', 'args', 'stacked'] },
};
/** The rail's miniature stubs its embeds (StoryRuntimeApp PREVIEW_REGISTRY). */
const PREVIEW_EMBEDS: Readonly<Record<string, string>> = { Question: 'chart', Number: '#', DataTable: 'table', Video: 'video' };
const PREVIEW_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: 120, border: '1px solid var(--border, rgba(128,128,128,0.35))', borderRadius: 6, background: 'color-mix(in srgb, var(--muted-foreground, gray) 6%, transparent)', font: '500 11px/1 var(--font-mono, ui-monospace, monospace)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted-foreground, graytext)' };
/** The rail's miniature registry (StoryRuntimeApp PREVIEW_REGISTRY): today's static kit with each embed a labelled box. */
const PREVIEW_COMPONENTS: StoryInterpreterOptions['components'] = {
  ...STORY_UI_COMPONENTS,
  ...Object.fromEntries(Object.entries(PREVIEW_EMBEDS).map(([tag, label]) => [tag, () => createElement('div', { style: PREVIEW_STYLE }, label)])),
};
/** Components whose HTML the React kit renders at compile time but whose BEHAVIOUR is not ported (reported as partial). None: every registered component with behaviour has its island. */
const PARTIAL: ReadonlySet<string> = new Set<string>([]);
/** Registered tags that render nothing (declarations, templates). */
const INERT: ReadonlySet<string> = new Set(['Helmet', 'Value', 'Query', 'Import', 'Mutation', 'Column']);
/** Registered components with behaviour: always an island root when ported (and the partial ones, which the browser would run). */
const ISLAND_TAGS: ReadonlySet<string> = new Set([...Object.keys(KIT).filter((tag) => KIT[tag]!.island), ...PARTIAL]);
/**
 * The editing cell's pieces (lib/islands/kit/cells, `@mx/kit/cells`), imported by name like a kit tag: the
 * control, and the cell scope's attribute resolver every element in a column's content uses.
 */
const CELL_EXPORTS: ReadonlySet<string> = new Set(['CellControl', 'cellAttrs']);
/** The tags today's editing cell draws (StoryRuntimeApp RuntimeCellControl); another tag with `run` in a cell draws nothing. */
const CELL_CONTROLS: ReadonlySet<string> = new Set(['Select', 'DatePicker', 'input', 'textarea', 'select']);
/** Today's native editing cell's classes (RuntimeCellControl), before the author's. */
const NATIVE_CELL = 'w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none transition-colors hover:border-border focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50';
/** What the editing cell reads of its authored props at run time (the rest are its element's attributes). */
const CELL_API = ['value', 'label', 'aria-label', 'placeholder', 'options', 'multiple', 'allowCreate', 'valueFormat', 'nullable', 'exclude', 'min', 'max', 'type', 'args', 'disabled'];
/** A column's content that draws something (components/kit/data-table: whitespace alone is no template). */
const hasContent = (nodes: JsxNode[]): boolean => nodes.some((n) => n.type !== 'text' || !!n.value.trim());
/** A rail miniature served inert, put in place by the deck behaviour (lib/islands/deck RAIL_THUMB_ATTR, the same name). */
const RAIL_THUMB_ATTR = 'data-mx-thumb';
/** The skeleton's placeholder for a static subtree's HTML (bundle.server STATIC_SLOT, the same name). */
const STATIC_SLOT = 'mx-static';
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

/** The element a SHELL's children are spliced at (a `<template>`: the HTML parser keeps it in place inside a table). */
const HOLE_ATTR = 'data-mx-hole';

/** How `htmlToJsx` writes a shell: the hole's content, and each element's attributes (a row template's go through `$rowAttrs`). */
interface HtmlToJsxOptions { hole?: () => string; attrs?: (attrs: Attr[]) => string }

/** Static HTML (from React's server renderer) → Solid JSX with every value a string literal. */
export function htmlToJsx(html: string, svg = false, options: HtmlToJsxOptions = {}): string {
  const frag = parseFragment(svg ? `<svg>${html}</svg>` : html) as unknown as P5Node;
  const nodes = svg ? frag.childNodes?.[0]?.childNodes ?? [] : frag.childNodes ?? [];
  const walk = (n: P5Node): string => {
    if (n.nodeName === '#text') return n.value ? `{${lit(n.value)}}` : '';
    if (n.nodeName === '#comment' || !n.tagName) return '';
    if (options.hole && n.tagName === 'template' && n.attrs?.some((a) => a.name === HOLE_ATTR)) return options.hole();
    const tag = safeTag(n.tagName);
    const pairs = (n.attrs ?? []).map((a): Attr => [safeAttr(a.prefix ? `${a.prefix}:${a.name}` : a.name), a.value]);
    const attrs = options.attrs ? options.attrs(pairs) : pairs.map(([name, value]) => ` ${name}={${lit(value)}}`).join('');
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

/**
 * A component tag the reader draws nothing for (legacy markup such as `<Param>`): in neither the reader's
 * registry (StoryRuntimeApp RUNTIME_REGISTRY: the story registry plus the kit's store adapters) nor a
 * declaration, nor a structural node — the interpreter's renderNode returns null for it.
 */
const unregistered = (node: JsxElement): boolean => node.isComponent && !node.control && !INERT.has(node.tag) && !STORY_UI_COMPONENTS[node.tag] && !KIT[node.tag];

const isTableParts = (node: JsxElement): boolean => node.children.every((c) => (c.type === 'text' ? !c.value.trim() : c.type === 'element' && ['tr', 'td', 'th'].includes(c.tag)));

/** The managed frame's author content compiled as inert data (lib/story/managed-iframe), or null when it is refused. */
const managedFrameOf = (node: JsxElement) => { try { return compileManagedIframe(node); } catch { return null; } };

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
  /** Inside a DataTable column's content: `scope` names the row's CellScope, and attributes resolve through `cellAttrs`. */
  cell?: boolean;
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
  /**
   * The skeleton's static subtrees as today's React render, in order: the skeleton holds a
   * `<mx-static data-i="n">` for each, which bundle.server splices after rendering it (`spliceStatics`).
   */
  statics: string[];
}

/** One version's facts the generator reads (CompileInput without the build). */
type GenerateInput = Omit<CompileInput, 'build'> & { glyphCatalogUrl?: string };

export function generate(input: GenerateInput): Generated {
  const refData = input.refData ?? {};
  const nodes = input.nodes ?? [];
  const islands: IslandBuild[] = [];
  const reactStatic = new Set<string>();
  const partial = new Set<string>();
  const unported = new Set<string>();
  const kitUsed = { skeleton: new Set<string>(), islands: new Set<string>() };
  const statics: string[] = [];
  const rowIconNames = new Set<string>();
  const visitRowIcons = (node: JsxNode): void => {
    if (!isElement(node)) return;
    if (node.tag === 'For') {
      const each = node.attributes.find((a) => a.name === 'each')?.value;
      const signalName = each && !each.static && each.reactive?.kind === 'signal' ? each.reactive.name : null;
      const table = signalName ? input.flow?.values.find((v) => v.name === signalName && v.kind === 'table') : null;
      if (table?.rows) for (const child of node.children) {
        const findNames = (part: JsxNode): void => {
          if (!isElement(part)) return;
          if (part.tag === 'Icon') {
            const raw = part.attributes.find((a) => a.name === 'name')?.value;
            if (raw?.static && typeof raw.json === 'string') for (const row of table.rows ?? []) {
              const name = substituteRow(raw.json, row);
              if (name) rowIconNames.add(name);
            }
          }
          part.children.forEach(findNames);
        };
        findNames(child);
      }
    }
    node.children.forEach(visitRowIcons);
  };
  nodes.forEach(visitRowIcons);
  const glyphs = rowIconNames.size ? { ...input.glyphs, ...buildGlyphMap(rowIconNames) } : input.glyphs ?? {};
  let usesRowClass = false;
  /** A skeleton static subtree's HTML, carried beside the skeleton (never through JSX, Babel and Solid's server renderer). */
  const staticSlot = (html: string): string => { statics.push(html); return `<${STATIC_SLOT} data-i={${lit(String(statics.length - 1))}}></${STATIC_SLOT}>`; };
  /**
   * A static subtree's names, checked as the JSX path checks them (a tag outside the grammar refuses the compile;
   * React drops a malformed attribute name itself), and the registered components it renders, reported.
   */
  const accountStatic = (node: JsxNode): void => {
    if (!isElement(node)) return;
    if (node.isComponent) { if (STORY_UI_COMPONENTS[node.tag]) reactStatic.add(node.tag); } else if (!node.control) safeTag(node.tag);
    node.children.forEach(accountStatic);
  };
  const grids = new WeakMap<JsxNode, boolean>();
  /** Does this subtree hold a Grid (a compile-time macro, emitted by emitGrid)? */
  const holdsGrid = (node: JsxNode): boolean => {
    if (!isElement(node)) return false;
    const known = grids.get(node);
    if (known !== undefined) return known;
    const value = node.tag === 'Grid' || node.tag === 'GridItem' || node.children.some(holdsGrid);
    grids.set(node, value);
    return value;
  };
  const needs = new WeakMap<JsxNode, boolean>();
  const needsBrowser = (node: JsxNode): boolean => {
    const known = needs.get(node);
    if (known !== undefined) return known;
    const value = !(isElement(node) && unregistered(node)) && (selfDynamic(node) || (isElement(node) && node.children.some(needsBrowser)));
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

  /**
   * Render one subtree with the React kit (the interpreter, its registry, the glyph provider), with its real AST
   * paths. `render` picks the registry and the values: the static kit at no values by default; the rail's
   * miniature registry at the declared values for a slide thumbnail.
   */
  function reactStaticHtml(node: JsxElement, path: string, ctx: Ctx, render: { components: StoryInterpreterOptions['components']; values: Record<string, unknown> } = { components: STORY_UI_COMPONENTS, values: {} }): string {
    const prefix = path.split('.');
    // The runtime's own decoration (StoryRuntimeApp decorateElement): `ref:` sources resolved, then the path rebased.
    const rebase: Decorate = (element, n, p) => {
      const patch = resolveRefProps(n, element.props as Props, refData);
      return cloneElement(element as ReactElement<Props>, { ...(patch ?? {}), [AST]: [...prefix, ...p.split('.').slice(1)].join('.') });
    };
    const decorate: Decorate = ctx.preview ? (element, n, p) => ctx.preview!(rebase(element, n, p) as ReactElement, n, p) : rebase;
    // React's hoisted image preloads are dropped: a compiled page names its preloads in the head.
    return renderToStaticMarkup(createElement(IconGlyphProvider, { value: glyphs }, renderStoryNodes([node], { values: render.values, components: render.components, decorateElement: decorate })))
      .replace(/<link rel="preload"[^>]*>/g, '');
  }
  const reactStaticJsx = (node: JsxElement, path: string, ctx: Ctx): string => htmlToJsx(reactStaticHtml(node, path, ctx), !!ctx.svg);

  /**
   * A registered component with no Solid port that the browser must reach INTO (it holds an island, a `$`
   * value, or sits in a row): a container with no behaviour of its own, so it compiles as a SHELL. Today's
   * React kit renders the component at compile time around a hole, and its children compile into the hole
   * — islands inside hydrate, static parts stay HTML. Its own props are rendered without a row, so a row
   * template (`{$_row.f}`) stays literal in its attributes and `$rowAttrs` fills it per row, exactly as a
   * native element in a row is compiled. A component that draws no children (an `<Icon>`'s glyph) is its
   * shell alone, as today's render drops them too.
   */
  function shellJsx(node: JsxElement, path: string, mode: Mode, ctx: Ctx): string {
    reactStatic.add(node.tag);
    const hole: JsxElement = { type: 'element', tag: 'template', isComponent: false, attributes: [{ name: HOLE_ATTR, value: { static: true, json: '' }, start: node.start, end: node.start }], children: [], selfClosing: true, start: node.start, end: node.start };
    let html: string;
    let holed = node.children.length > 0;
    try {
      html = reactStaticHtml({ ...node, children: holed ? [hole] : [] }, path, ctx);
    } catch (error) {
      if (!holed) throw error;
      // A component whose element carries markup of its own cannot also take children (React refuses both).
      holed = false;
      html = reactStaticHtml({ ...node, children: [] }, path, ctx);
    }
    const children = (): string => node.children.map((c, i) => emit(c, `${path}.${i}`, mode, ctx)).join('');
    const row = ctx.row;
    const authoredClass = node.attributes.find((a) => a.name === 'className' || a.name === 'class')?.value;
    const rowClassTemplate = row && authoredClass?.static && typeof authoredClass.json === 'string' ? authoredClass.json : null;
    const withoutClass = rowClassTemplate === null ? '' : reactStaticHtml({ ...node, attributes: node.attributes.filter((a) => a.name !== 'className' && a.name !== 'class'), children: holed ? [hole] : [] }, path, ctx);
    const baseClass = (/\bclass="([^"]*)"/.exec(withoutClass)?.[1] ?? '')
      .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    let first = true;
    return htmlToJsx(html, !!ctx.svg, {
      ...(holed ? { hole: children } : {}),
      ...(row ? { attrs: (attrs: Attr[]) => {
        const root = first; first = false;
        if (root && rowClassTemplate !== null) {
          usesRowClass = true;
          return ` {...${rowAttrsFn(mode, ctx)}(${json(Object.fromEntries(attrs.filter(([name]) => name !== 'class')))}, ${row}, ${ctx.scope})} class={$rowClass(${lit(baseClass)}, ${lit(rowClassTemplate)}, ${row})}`;
        }
        return ` {...${rowAttrsFn(mode, ctx)}(${json(Object.fromEntries(attrs))}, ${row}, ${ctx.scope})}`;
      } } : {}),
    });
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
    // An unregistered component (legacy markup such as `<Param>`) renders nothing, as the interpreter's renderNode does.
    if (unregistered(node)) return '';
    // A managed frame whose content is refused renders nothing (the interpreter's renderNode), island or not.
    if (node.tag === 'Iframe' && !ctx.row && managedFrameOf(node) === null) return '';
    // A static subtree of the SKELETON is today's React render (the interpreter, parity by construction), carried as
    // HTML and spliced in after the skeleton renders: no JSX re-parse, no Babel, no Solid render of static markup —
    // most of a large document's compile. Never inside an island (hydration walks its template) and never across a
    // Grid (a compile-time macro, emitGrid).
    if (mode === 'static' && !ctx.row && !needsBrowser(node) && !holdsGrid(node)) { accountStatic(node); return staticSlot(reactStaticHtml(node, path, ctx)); }
    // An island root in the skeleton: rendered by its own island component, spliced in by the server.
    if (mode === 'static' && !PARTIAL.has(node.tag) && needsBrowser(node) && (selfDynamic(node) || mustPromote(node))) {
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
    // A control with `run` in a column's content is an editing cell (interpreter renderNode → cellControl).
    const run = node.attributes.find((a) => a.name === 'run');
    if (ctx.cell && node.tag !== 'Button' && run?.value.static && typeof run.value.json === 'string' && refName(run.value.json)) {
      const cellTag = node.isComponent ? node.tag : node.tag.toLowerCase();
      if (CELL_CONTROLS.has(cellTag)) return emitCellControl(node, cellTag, path, mode, ctx);
      if (!node.isComponent) return '';
    }
    if (ctx.preview && PREVIEW_EMBEDS[node.tag]) return `<div${attrsJsx(domAttrs('div', { style: PREVIEW_STYLE }))}>{${lit(PREVIEW_EMBEDS[node.tag])}}</div>`;
    if (node.isComponent) {
      const meta = KIT[node.tag];
      // A STATIC registered component: today's React kit renders it AT COMPILE TIME (parity by
      // construction) and its HTML becomes static JSX — in the skeleton whether or not the Solid kit
      // ports it, inside an island when it has no port. Nothing of it ever reaches a reader as code.
      const staticHere = !ctx.row && !!STORY_UI_COMPONENTS[node.tag] && (!needsBrowser(node) || PARTIAL.has(node.tag));
      if (staticHere && (!meta || mode === 'static')) { (PARTIAL.has(node.tag) ? partial : reactStatic).add(node.tag); return reactStaticJsx(node, path, ctx); }
      if (!meta && STORY_UI_COMPONENTS[node.tag]) return shellJsx(node, path, mode, ctx);
      if (!meta) { unported.add(node.tag); return `<div data-mx-unported={${lit(node.tag)}} data-mx-ast={${lit(path)}}></div>`; }
      useKit(node.tag, mode, ctx);
      const props = rawBuildProps(node.attributes, true, node.tag, path, undefined, {});
      // Decided here, never read from the author (interpreter BUTTON_TRIGGERS).
      if (node.tag === 'DialogTrigger' || node.tag === 'DialogClose') props.wrapsControl = wrapsControl(node);
      // Today's dialog stacks its fields (and its mutation form is `display:contents`) only without an author class.
      if (node.tag === 'DialogContent') props.stacked = !(typeof props.className === 'string' && props.className);
      // The runtime registry hands Mermaid the document's colour mode (StoryRuntimeApp RUNTIME_REGISTRY).
      if (node.tag === 'Mermaid') props.colorMode = input.colorMode ?? 'light';
      // <Column> children ARE the column spec (interpreter DataTable templates → parseColumnSpecs(templates.map(t => t.props))).
      let cellsJsx = '';
      if (node.tag === 'DataTable') {
        const columns = node.children.flatMap((c, i) => (isElement(c) && c.tag === 'Column' ? [[c, i] as const] : []));
        const cols = columns.map(([c, i]) => rawBuildProps(c.attributes, true, 'Column', `${path}.${i}`, undefined, {}));
        if (cols.length) {
          props.columns = cols.map(({ [AST]: _ast, ...rest }) => rest);
          props.templates = cols.map((c, k) => {
            const ids = [...templateIds(columns[k]![0].children)];
            return { col: c.col, id: typeof c.id === 'string' ? c.id : undefined, path: c[AST], ...(ids.length ? { ids } : {}) };
          });
          cellsJsx = emitCells(columns, path, ctx);
        }
      }
      if (node.tag === 'Files' || node.tag === 'Icon') props.glyphs = glyphs;
      if (node.tag === 'Icon' && input.glyphCatalogUrl) props.catalogUrl = input.glyphCatalogUrl;
      if (node.tag === 'Iframe') {
        // The interpreter's rules (renderNode): refused inside a row, and invalid content renders nothing.
        if (ctx.row) return `<div role="alert">{${lit('DataTable and Iframe must be outside For templates')}}</div>`;
        props.compiled = managedFrameOf(node);
      }
      // The runtime hands the map the document's colour mode (StoryRuntimeApp RUNTIME_REGISTRY DeckGL).
      if (node.tag === 'DeckGL') props.colorMode = input.colorMode ?? 'light';
      const classes = peopleClasses(node.tag, props);
      if (classes) props.classes = classes;
      const viz = props.viz as { recipe?: unknown } | undefined;
      if (node.tag === 'Question' && typeof viz?.recipe === 'string' && viz.recipe.startsWith('ref:')) props.recipeData = refData[viz.recipe.slice(4)] ?? null;
      const api: Props = Object.fromEntries((meta.api ?? []).filter((k) => props[k] !== undefined).map((k) => [k, props[k]]));
      // Class strings come from the recipes index AT COMPILE TIME: readers never download cva or tailwind-merge.
      const recipe = RECIPES[node.tag];
      // In a fixed grid's tile the tile owns the size (components/kit/grid GridItemContext): the recipe and the port both know.
      const inGrid = !!(meta.grid && ctx.grid && !ctx.grid.flow);
      const cls = meta.dom === 'identity' ? null : node.tag === 'Icon' ? cn(ICON_BASE_CLASS, typeof props.className === 'string' ? props.className : undefined) : recipe ? cn(recipe({ ...props, ...(inGrid ? { inGridItem: true } : {}) })) : typeof props.className === 'string' ? props.className : null;
      let dom: Props = { ...props };
      for (const k of [...(meta.api ?? []), 'className']) delete dom[k];
      if (meta.dom) dom = Object.fromEntries(Object.entries(dom).filter(([k]) => k === 'id' || k === AST));
      // A `<Question>`'s chart box: the assembler puts the snapshot's drawing inside it (contract CHART_SLOT_ATTR).
      if (node.tag === 'Question') dom[CHART_SLOT_ATTR] = typeof dom.id === 'string' && dom.id ? dom.id : path;
      if (inGrid) api.inGridItem = true;
      const attrs = domAttrs('div', dom).filter(([n]) => n !== 'class');
      const apiJsx = Object.entries(api).map(([k, v]) => ` ${safeAttr(k)}={${typeof v === 'string' ? ctx.row ? `rt.sub(${lit(v)}, ${ctx.row})` : lit(v) : json(v)}}`).join('');
      const authorClass = typeof props.className === 'string' ? props.className : '';
      const rowClass = !!ctx.row && !!authorClass;
      if (rowClass) usesRowClass = true;
      const rowBase = rowClass ? node.tag === 'Icon' ? ICON_BASE_CLASS : recipe ? cn(recipe({ ...props, className: undefined, ...(inGrid ? { inGridItem: true } : {}) })) : '' : '';
      const clsJsx = rowClass
        ? ` class={$rowClass(${lit(rowBase)}, ${lit(authorClass)}, ${ctx.row})}`
        : cls ? ` class={${lit(cls)}}` : '';
      const tag = safeTag(node.tag);
      // A row action writes with its row (interpreter rowAction → StoryRuntimeApp RuntimeRowAction).
      const rowJsx = node.tag === 'Button' && (api.run !== undefined || api.set !== undefined) ? ` row={${ctx.row}} rowScope={${ctx.scope}}` : '';
      if (ctx.row) return `<${tag}${apiJsx}${rowJsx}${clsJsx} {...${rowAttrsFn(mode, ctx)}(${json(Object.fromEntries(attrs))}, ${ctx.row}, ${ctx.scope})}>${children()}</${tag}>`;
      return `<${tag}${apiJsx}${cellsJsx}${clsJsx}${attrsJsx(attrs)}>${meta.noChildren ? '' : children()}</${tag}>`;
    }
    const lower = node.tag.toLowerCase();
    const tag = safeTag(SVG_TAG_CASE[lower] ?? lower);
    // Values and row references share one image island; row attributes are substituted first.
    const source = lower === 'img' && !node.isComponent ? node.attributes.find((a) => a.name.toLowerCase() === 'src') : undefined;
    if (source?.value.static && typeof source.value.json === 'string'
      && (refName(source.value.json) || parseRowRef(source.value.json) || carriesRef(source.value.json))) {
      useKit('BoundImage', mode, ctx);
      const props = rawBuildProps(node.attributes.filter((a) => a !== source), false, node.tag, path, undefined, {});
      const attrs = json(Object.fromEntries(domAttrs(tag, props)));
      return `<BoundImage template={${lit(source.value.json)}} props={${ctx.row ? `${rowAttrsFn(mode, ctx)}(${attrs}, ${ctx.row}, ${ctx.scope})` : attrs}}${ctx.row ? ` row={${ctx.row}}` : ''} />`;
    }
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
    const inner = lower === 'svg' ? { ...ctx, svg: true } : ctx;
    const attrs = domAttrs(tag, props);
    const reactive = node.attributes.filter((a) => !a.value.static && REACTIVE_BOOLEAN_PROPS.has(a.name) && isReactiveExpression(a.value.reactive));
    const booleanJsx = reactive.map((a) => ` {...(rt.expr(${json(a.value.static ? null : a.value.reactive)}, ${ctx.row ?? 'undefined'}) ? { ${safeAttr(a.name)}: true } : {})}`).join('');
    if (ctx.row && lower === 'img') (mode === 'static' ? kitUsed.skeleton : kitUsed.islands).add('rowImageAttrs');
    const rowAttrs = ctx.row ? `${rowAttrsFn(mode, ctx)}(${json(Object.fromEntries(attrs))}, ${ctx.row}, ${ctx.scope})` : '';
    const open = ctx.row ? `<${tag} {...${lower === 'img' ? `rowImageAttrs(${rowAttrs})` : rowAttrs}}${booleanJsx}>` : `<${tag}${attrsJsx(attrs)}${booleanJsx}>`;
    if (VOID.test(lower)) return open.replace(/>$/, ' />');
    return `${open}${children(inner)}</${tag}>`;
  }

  /** An element's attributes in a row: a `<For>` row's through the basic kit, a table cell's through the cell scope. */
  function rowAttrsFn(mode: Mode, ctx: Ctx): string {
    if (!ctx.cell) return '$rowAttrs';
    useKit('cellAttrs', mode, ctx);
    return 'cellAttrs';
  }

  /**
   * A DataTable's column content (interpreter DataTable renderCell): one function per `<Column>`, aligned with
   * `templates`, a hole where the column draws nothing; each renders the content for one row and its CellScope.
   */
  function emitCells(columns: ReadonlyArray<readonly [JsxElement, number]>, path: string, ctx: Ctx): string {
    const fns = columns.map(([column, i]) => {
      if (!hasContent(column.children)) return 'undefined';
      const cpath = `${path}.${i}`;
      const suffix = cpath.replace(/\./g, '_');
      const inner: Ctx = { row: `row${suffix}`, scope: `cell${suffix}`, cell: true, svg: false, island: ctx.island };
      return `(${inner.row}, ${inner.scope}) => <>${column.children.map((c, k) => emit(c, `${cpath}.${k}`, 'island', inner)).join('')}</>`;
    });
    return fns.some((f) => f !== 'undefined') ? ` cells={[${fns.join(', ')}]}` : '';
  }

  /**
   * Today's editing cell (StoryRuntimeApp RuntimeCellControl). What differs per row — the row's values, the
   * scope, the draft, the write check — is resolved by `CellControl`; everything authored is decided here, as
   * today's React renders it: the element's attributes serialised by React's server renderer, and its class
   * merged by the kit's merger (order included).
   */
  function emitCellControl(node: JsxElement, tag: string, path: string, mode: Mode, ctx: Ctx): string {
    useKit('CellControl', mode, ctx);
    const props = rawBuildProps(node.attributes, node.isComponent, node.tag, path, undefined, {});
    // In a row the interpreter keeps a field's controlled name (rawBuildProps with a row): undo the static rename.
    if ('defaultValue' in props) { props.value = props.defaultValue; delete props.defaultValue; }
    const { run, value: _value, 'aria-label': _label, disabled: _disabled, exclude: _exclude, className, ...rest } = props;
    const valueAttr = node.attributes.find((a) => a.name === 'value');
    const field = valueAttr?.value.static ? parseRowRef(valueAttr.value.json) : null;
    const api = Object.fromEntries(CELL_API.filter((k) => props[k] !== undefined).map((k) => [k, props[k]]));
    const author = typeof className === 'string' ? className : undefined;
    let attrs: Attr[];
    let cls: string;
    if (tag === 'Select' || tag === 'DatePicker') {
      attrs = domAttrs('div', shellRest(rest));
      cls = cn('mx-control relative inline-flex flex-col gap-1.5 align-top', cn('flex w-full min-w-0', author));
    } else {
      attrs = domAttrs(tag, rest);
      cls = cn(NATIVE_CELL, tag === 'textarea' ? 'min-h-8 resize-y' : 'h-8', props.type === 'number' && 'text-right tabular-nums', author);
    }
    const children = node.children.map((c, i) => emit(c, `${path}.${i}`, mode, ctx)).join('');
    return `<CellControl tag={${lit(tag)}} run={${lit(refName(run))}}${field ? ` field={${lit(field)}}` : ''} p={${json(api)}} attrs={${json(Object.fromEntries(attrs.filter(([n]) => n !== 'class')))}} cls={${lit(cls)}} path={${lit(path)}} row={${ctx.row}} cell={${ctx.scope}}>${children}</CellControl>`;
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
    const previewValues = declaredValues(input.flow);
    const rail = slides.map((slide) => {
      // Drawn as today's rail draws it (StoryRuntimeApp SlideRail): the interpreter over the miniature registry at
      // the declared values, whatever the slide holds — a miniature never hydrates.
      const html = reactStaticHtml(slide.node, '0', { row: null, preview: allocate([slide.node], slide.path) }, { components: PREVIEW_COMPONENTS, values: previewValues });
      // A miniature holding a button sits in the rail row's own button: parsed in place, the inner button would close
      // the row. Served inert in a `<template>` (a parser scope boundary) and put in place by the deck behaviour
      // (lib/islands/deck RAIL_THUMB_ATTR), so the rail ends as the tree today's rail renders.
      const thumb = /<button\b/i.test(html) ? `<template ${RAIL_THUMB_ATTR}="">${staticSlot(html)}</template>` : staticSlot(html);
      return `<button type="button" class="mx-rail-row" aria-label={${lit(`Go to slide ${slide.index + 1}: ${slide.title}`)}} aria-current={${lit(String(slide.index === 0))}}><span class="mx-rail-label"><span class="mx-rail-index">{${lit(String(slide.index + 1))}}</span><span class="mx-rail-title">{${lit(slide.title)}}</span></span><span class="mx-rail-thumb" aria-hidden="true"><div style="--mx-vh:800px">${thumb}</div></span></button>`;
    }).join('');
    root = `<div class="mx-deck"><nav class="mx-rail" aria-label="Slides">${rail}</nav>${root}<div class="mx-present" aria-label="Slide controls"><button type="button" aria-label="Previous slide">{"‹"}</button><span class="mx-present-count" aria-label="Slide position">{${lit(`1 / ${slides.length}`)}}</span><button type="button" aria-label="Next slide">{"›"}</button><button type="button" aria-label="Present">{"present"}</button></div></div>`;
  }

  const kitImports = (set: Set<string>): string => {
    const byMod: Record<string, string[]> = {};
    for (const tag of set) (byMod[tag === 'BoundNative' ? 'controls' : tag === 'BoundImage' || tag === 'rowImageAttrs' ? 'files' : CELL_EXPORTS.has(tag) ? 'cells' : KIT[tag]!.mod] ??= []).push(tag);
    return Object.entries(byMod).sort(([a], [b]) => a.localeCompare(b)).map(([mod, tags]) => `import { ${tags.sort().map(safeProp).join(', ')} } from ${lit(`@mx/kit/${safeTag(mod)}`)};\n`).join('');
  };
  const dataConsts = data.map((text, i) => `const $d${i} = JSON.parse(${lit(text)});\n`).join('');
  // The skeleton imports only what it renders with; the islands module always carries the runtime.
  const skeleton = `${kitImports(kitUsed.skeleton)}${dataConsts}export default function Skeleton() { return ${root}; }\n`;
  const usesRowAttrs = islands.some((isl) => isl.source.includes('$rowAttrs('));
  const islandsSource = `import * as rt from '@mx/rt';\n${usesRowAttrs ? "import { rowAttrs as $rowAttrs } from '@mx/kit/basic';\n" : ''}${usesRowClass ? "import { rowClass as $rowClass } from '@mx/row-class';\n" : ''}${kitImports(kitUsed.islands)}${dataConsts}`
    + islands.map((isl) => `export function I${isl.id}() { return ${isl.source}; }\n`).join('')
    + `export const ISLANDS = [${islands.map((isl) => `[${lit(`s${isl.id}-`)}, I${isl.id}, ${lit(islandKey(isl.source, data))}]`).join(', ')}];\n`;
  return {
    skeleton,
    islands: islandsSource,
    islandRefs: islands.map((isl) => ({ renderId: `s${isl.id}-`, path: isl.path, kit: [...isl.kit].sort(), readsData: isl.readsData })),
    kit: { skeleton: [...kitUsed.skeleton].sort(), islands: [...kitUsed.islands].sort() },
    reactStatic: [...reactStatic].sort(),
    unported: [...unported].sort(),
    partial: [...partial].sort(),
    behaviors: deck ? [DECK_BEHAVIOR] : [],
    statics,
  };
}

/**
 * AN ISLAND'S KEY: a digest of its definition — its generated source with every hoisted constant
 * (`$d<n>`, numbered by position in the whole module) replaced by the data it names — so two versions'
 * islands have the same key exactly when they are the same island, wherever the rest of the document
 * moved. The live morph (lib/islands/morph/engine) keeps a running island whose key a new version
 * carries again. Its AST paths are part of the definition: an island that moved is drawn afresh.
 * FNV-1a over two lanes (64 bits, hex): an identity, not a secret.
 */
export function islandKey(source: string, data: readonly string[]): string {
  const text = source.replace(/\$d(\d+)\b/g, (whole, n: string) => data[Number(n)] ?? whole);
  let a = 0x811c9dc5, b = 0xcbf29ce4;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x01000197) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
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
  const generated = generate({ ...input, glyphCatalogUrl: build.manifest['@mx/glyphs'] });
  const unknown = generated.behaviors.filter((b) => !build.manifest[b]);
  if (unknown.length) throw new Error(`compile: the island build carries no ${unknown.join(', ')}`);
  // Classified with the anonymous reader's admission the caller decided (snapshots.server
  // anonymousAccessFacts), so this is the plan snapshots key on; without it no dataset is admitted and
  // every query that reads one is `viewer` — never a private answer in a guest snapshot.
  const plan = input.flow ? planOf(input.flow, input.access ?? { datasets: {} }) : null;
  const links = input.nodes.length ? linkHintsOf(input.nodes, { origins: deploymentOrigins() }) : EMPTY_LINK_HINTS;
  const outlinePlan = input.template === 'plan';
  const outline = input.chrome && (input.template === 'editorial' || outlinePlan) && hasOutline(input.nodes)
    ? discoverOutline(input.nodes) : [];
  const base = {
    build: build.id, islands: generated.islandRefs, behaviors: generated.behaviors, plan, links, outline, outlinePlan,
    kit: generated.kit, reactStatic: generated.reactStatic, unported: generated.unported, partial: generated.partial,
    // Data for the page's JSON island, never module code (contract CompiledPage.authorScript).
    authorScript: input.authorScript || null,
  };
  if (generated.unported.length) return { ...base, html: '', module: null, ssr: null };
  // A version with an author script boots even with no island: its store and its author host start there.
  const built = await buildDocumentModules(generated, { build, flow: input.flow, values: declaredValues(input.flow), boot: !!base.authorScript });
  return { ...base, html: built.html, module: built.module, ssr: built.ssr };
}
