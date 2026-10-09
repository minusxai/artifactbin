/**
 * THE PUBLISH-TIME COMPILER (docs/phase2-architecture.md §2.1, §3, §4.1, §9; contract `CompilePage`).
 *
 * One document version (its parsed nodes, as the prepared page holds them) → Solid JSX sources:
 *
 *   skeleton   the whole story, rendered on the server WITHOUT hydration: its static parts become
 *              HTML at compile time and never reach a reader as JavaScript. Every static subtree,
 *              including registered components and deck rail previews, uses Solid JSX.
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
 * interpreter's `rawBuildProps` (rendering only: the markup policy — handlers, denied attributes, URL
 * schemes — is publish validation's, lib/jsx/validate) and serialized by framework-free `reactAttrs`. Reactive expressions travel as data and are evaluated by the
 * runtime with lib/jsx/reactive. `codegen-safety.ts structureIndependent` is the proof.
 *
 * Pure and deterministic for one input.
 */
import { escapeHtml } from '@artifactbin/utils/escape';
import { rawBuildProps, wrapsControl, templateIds } from '@/lib/story-ui/interpreter-primitives';
import { SOURCE_NODE_ID_ATTR } from '@/lib/story-ui/ast-path';
import { STORY_SVG_TAGS } from '@/lib/jsx/component-names';
import { isScriptComponent, MOUNT_ATTR } from '@/lib/story-runtime/script-mount';
import { gridCols, gridRowHeight, gridItemRect, gridRows } from '@/lib/story-ui/grid-layout';
import { ICON_BASE_CLASS } from '@/lib/story-ui/icon-contract';
import { buildGlyphMap } from '@/lib/story-ui/icon-glyphs.server';
import { evaluateReactive, isReactiveExpression, REACTIVE_BOOLEAN_PROPS } from '@/lib/jsx/reactive';
import { parseRowRef } from '@/lib/jsx/row-scope';
import type { JsxElement, JsxNode } from '@/lib/jsx';
import { collectRefNameUses, REF_ATTRS, carriesRef, refName, type Scalar } from '@/lib/dataflow/dataflow';
import { resolveRefProps } from '@/lib/dataflow/ref-data';
import { substituteRow } from '@/lib/jsx/row-scope';
import { discoverSlides, MIN_SLIDES_FOR_RAIL } from '@/lib/story-runtime/slides';
import { discoverOutline, hasOutline } from '@/lib/story-runtime/outline';
import { createPreviewPropsAllocator } from '@/lib/story-runtime/preview-props';
import { PUBLIC_BASE_URL } from '@/lib/platform/config';
import { cn, peopleClasses, RECIPES } from '@/lib/islands';
import type { GeneratedSources } from './codegen-safety';
import { CHART_SLOT_ATTR, EMPTY_LINK_HINTS, MIN_HANDOVER_CONTRACT, type CompileInput, type CompiledPage, type CompilerBuild, type IslandRef } from './contract';
import { linkHintsOf } from './links';
import { planOf } from './plan';
import { buildDocumentModules, loadKitServer, type KitServer } from './bundle.server';
import { contentSha } from './speculation';
import { MODULE_DATA_READ_CODE } from './carriers';
import { reactAttrs } from './static-solid/attrs';
import { kitServerHtml, solidAttrs, solidChildren, solidText, solidTextChild, solidTextValue, solidTrimText, staticChunkJsx, SOLID_SPECIAL_TAGS } from './static-solid/html';
import { markdownContent, markdownSource } from '@/lib/markdown/content';

/* ────────────────────────────────────────────────────────────────────────────
 * Literals and names: the only doors author text has into generated code
 * ──────────────────────────────────────────────────────────────────────────── */

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
/** A JS string literal for ANY author-derived text: JSON, plus the characters JSON leaves raw that matter in HTML/JS. */
const lit = (value: unknown): string => JSON.stringify(String(value)).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replaceAll(LS, '\\u2028').replaceAll(PS, '\\u2029');
const TAG = /^[a-z][a-z0-9-]*$/i;
const ATTR = /^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const safeTag = (tag: string): string => { if (!TAG.test(tag)) throw new Error(`compile: refused tag name ${JSON.stringify(tag)}`); return tag; };
const safeAttr = (name: string): string => { if (!ATTR.test(name)) throw new Error(`compile: refused attribute name ${JSON.stringify(name)}`); return name; };
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

/**
 * Which module each ported kit component comes from, and its API props (everything else is a DOM attribute).
 * Compiler-native tags such as Markdown, Grid and For render directly; they have no shared kit export.
 */
export const KIT: Readonly<Record<string, KitMeta>> = {
  Badge: { mod: 'basic', api: ['variant'] }, Alert: { mod: 'basic', api: ['variant'] }, AlertTitle: { mod: 'basic' }, AlertDescription: { mod: 'basic' },
  Progress: { mod: 'basic', api: ['value'] }, Icon: { mod: 'basic', api: ['name', 'glyphs', 'catalogUrl'] },
  Card: { mod: 'basic' }, CardHeader: { mod: 'basic' }, CardTitle: { mod: 'basic' }, CardDescription: { mod: 'basic' }, CardAction: { mod: 'basic' }, CardContent: { mod: 'basic' }, CardFooter: { mod: 'basic' },
  Tabs: { mod: 'tabs', island: true, api: ['defaultValue', 'value', 'orientation', 'dir'] }, TabsList: { mod: 'tabs', api: ['variant'] }, TabsTrigger: { mod: 'tabs', api: ['value', 'disabled'] }, TabsContent: { mod: 'tabs', api: ['value', 'forceMount'] },
  Accordion: { mod: 'accordion', island: true, api: ['type', 'collapsible', 'defaultValue', 'value', 'orientation'] }, AccordionItem: { mod: 'accordion', api: ['value', 'disabled'] }, AccordionTrigger: { mod: 'accordion' }, AccordionContent: { mod: 'accordion', api: ['forceMount'] },
  // Store adapters: the DOM carries only the node's identity (id, data-mx-ast).
  // Number, Select and DataTable read the author's class as `className` (kit/data), never the compiler's `class`.
  Number: { mod: 'data', island: true, api: ['data', 'col', 'agg', 'prefix', 'suffix', 'format', 'className'], dom: 'identity' },
  Question: { mod: 'data', island: true, api: ['data', 'viz', 'title', 'height', 'recipeData'], dom: 'identity', grid: true },
  // The live grid puts the author's class on its `data-slot="data-table"` box (recipes/data), and its adapter wrapper takes `id`/`data-*`.
  DataTable: { mod: 'data', island: true, api: ['data', 'columns', 'sort', 'height', 'sticky', 'rowKey', 'templates', 'className'], dom: 'identity', grid: true, noChildren: true },
  Files: { mod: 'files', island: true, api: ['data', 'variant', 'glyphs'], dom: 'identity' },
  Select: { mod: 'data', island: true, api: ['label', 'placeholder', 'value', 'options', 'className'] },
  Button: { mod: 'basic', api: ['variant', 'size', 'run', 'set', 'args'] },
  Mermaid: { mod: 'mermaid', island: true, api: ['code', 'title', 'colorMode'], grid: true },
  FileUpload: { mod: 'upload', island: true, api: ['dataset', 'value', 'busy', 'multiple', 'accept', 'label', 'maxFiles', 'disabled', 'className'] },
  Input: { mod: 'controls', island: true, api: ['label', 'placeholder', 'value', 'type', 'min', 'max', 'step', 'aria-label'] },
  Textarea: { mod: 'controls', island: true, api: ['label', 'placeholder', 'value', 'rows', 'aria-label'] },
  Segmented: { mod: 'controls', island: true, api: ['label', 'placeholder', 'value', 'options'] },
  Slider: { mod: 'controls', island: true, api: ['label', 'value', 'min', 'max', 'step', 'format', 'prefix', 'suffix'] },
  Switch: { mod: 'controls', island: true, api: ['label', 'checked'] },
  DatePicker: { mod: 'controls', island: true, api: ['label', 'value', 'min', 'max'] },
  Collapsible: { mod: 'disclosure', island: true, api: ['defaultOpen', 'open', 'disabled'] }, CollapsibleTrigger: { mod: 'disclosure' }, CollapsibleContent: { mod: 'disclosure', api: ['forceMount'] },
  Popover: { mod: 'disclosure', island: true, api: ['defaultOpen'] }, PopoverTrigger: { mod: 'disclosure' }, PopoverContent: { mod: 'disclosure', api: ['forceMount'] }, PopoverAnchor: { mod: 'disclosure' },
  PopoverHeader: { mod: 'disclosure' }, PopoverTitle: { mod: 'disclosure' }, PopoverDescription: { mod: 'disclosure' },
  TooltipProvider: { mod: 'disclosure', island: true }, Tooltip: { mod: 'disclosure', island: true, api: ['defaultOpen'] }, TooltipTrigger: { mod: 'disclosure' }, TooltipContent: { mod: 'disclosure', api: ['forceMount'] },
  Avatar: { mod: 'disclosure', island: true, api: ['size'] }, AvatarImage: { mod: 'disclosure' }, AvatarFallback: { mod: 'disclosure' }, AvatarBadge: { mod: 'disclosure' }, AvatarGroup: { mod: 'disclosure' }, AvatarGroupCount: { mod: 'disclosure' },
  // A person's class depends on whom it resolves to in the browser (a guest's fallback, a card): every state's class
  // is evaluated here (recipes/people peopleClasses) and handed to the port as `classes`.
  User: { mod: 'people', island: true, api: ['userId', 'fallback', 'avatar', 'link', 'classes'] }, UserImage: { mod: 'people', island: true, api: ['userId', 'fallback', 'size', 'decorative', 'classes'] }, UserHandle: { mod: 'people', island: true, api: ['userId', 'fallback', 'link', 'classes'] }, SignIn: { mod: 'people', island: true },
  // Embeds with behaviour in a lazy chunk (lib/islands/kit/embed, their own family): the map.
  DeckGL: { mod: 'embed', island: true, api: ['data', 'layers', 'basemap', 'initialViewState', 'tooltip', 'legend', 'title', 'height', 'colorMode'], dom: 'box', grid: true },
  Dialog: { mod: 'dialog', island: true, api: ['defaultOpen', 'open'] }, DialogTrigger: { mod: 'dialog', api: ['wrapsControl', 'disabled'] }, DialogClose: { mod: 'dialog', api: ['wrapsControl', 'disabled'] }, DialogContent: { mod: 'dialog', api: ['run', 'args', 'stacked'] },
  Table: { mod: 'static' }, TableHeader: { mod: 'static' }, TableBody: { mod: 'static' }, TableFooter: { mod: 'static' }, TableRow: { mod: 'static' }, TableHead: { mod: 'static' }, TableCell: { mod: 'static' }, TableCaption: { mod: 'static' },
  Separator: { mod: 'static', api: ['orientation', 'decorative'] }, Skeleton: { mod: 'static' },
  Breadcrumb: { mod: 'static' }, BreadcrumbList: { mod: 'static' }, BreadcrumbItem: { mod: 'static' }, BreadcrumbLink: { mod: 'static' }, BreadcrumbPage: { mod: 'static' }, BreadcrumbSeparator: { mod: 'static' }, BreadcrumbEllipsis: { mod: 'static' },
  SlideDeck: { mod: 'static' }, Slide: { mod: 'static', api: ['title'] }, File: { mod: 'static', api: ['src', 'title', 'name', 'bytes', 'pages', 'interactive'] },
};
/**
 * Kit components whose server render is a pure function of static props (no behaviour, no context, no asset or
 * deck lookup): a static one renders to HTML at compile time with the plain elements (`kitHtml`).
 */
const KIT_CHUNK: ReadonlySet<string> = new Set([
  'Table', 'TableHeader', 'TableBody', 'TableFooter', 'TableRow', 'TableHead', 'TableCell', 'TableCaption',
  'Card', 'CardHeader', 'CardTitle', 'CardDescription', 'CardAction', 'CardContent', 'CardFooter',
  'Badge', 'Alert', 'AlertTitle', 'AlertDescription', 'Progress', 'Icon', 'Separator', 'Skeleton',
  'Breadcrumb', 'BreadcrumbList', 'BreadcrumbItem', 'BreadcrumbLink', 'BreadcrumbPage', 'BreadcrumbSeparator', 'BreadcrumbEllipsis',
  // A Button without run/set (one with them is an island), a File (its `ref:` src resolved here, `kitParts`), a deck's
  // SlideDeck and Slide (named by a pattern: a new string literal here would join the recipe class union, recipe-classes.ts,
  // and flip every story's CSS compile version).
  'Button', 'File', ...Object.keys(KIT).filter((tag) => /^Slide(?:Deck)?$/.test(tag)),
]);
/** The rail's miniature stubs its embeds. */
const PREVIEW_EMBEDS: Readonly<Record<string, string>> = { Question: 'chart', Number: '#', DataTable: 'table' };
const PREVIEW_STYLE = { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', minHeight: 120, border: '1px solid var(--border, rgba(128,128,128,0.35))', borderRadius: 6, background: 'color-mix(in srgb, var(--muted-foreground, gray) 6%, transparent)', font: '500 11px/1 var(--font-mono, ui-monospace, monospace)', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--muted-foreground, graytext)' };
/** Components whose HTML is rendered at compile time but whose BEHAVIOUR is not ported (reported as partial). None: every registered component with behaviour has its island. */
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
/** The tags the editing cell draws; another tag with `run` in a cell draws nothing. */
const CELL_CONTROLS: ReadonlySet<string> = new Set(['Select', 'DatePicker', 'input', 'textarea', 'select']);
/** The native editing cell's classes, before the author's. */
const NATIVE_CELL = 'w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 py-1 text-sm outline-none transition-colors hover:border-border focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:opacity-50';
/** What the editing cell reads of its authored props at run time (the rest are its element's attributes). */
const CELL_API = ['value', 'label', 'aria-label', 'placeholder', 'options', 'multiple', 'allowCreate', 'valueFormat', 'nullable', 'exclude', 'min', 'max', 'type', 'args', 'disabled'];
/** The authored control props that remain on its static wrapper. */
const shellRest = ({ label: _label, placeholder: _placeholder, className: _className, value: _value, options: _options, multiple: _multiple, allowCreate: _allowCreate, valueFormat: _valueFormat, checked: _checked, min: _min, max: _max, step: _step, format: _format, prefix: _prefix, suffix: _suffix, disabled: _disabled, children: _children, ...rest }: Props): Props => rest;
/** A column's content that draws something. */
const hasContent = (nodes: JsxNode[]): boolean => nodes.some((n) => n.type !== 'text' || !!n.value.trim());
/** A rail miniature served inert, put in place by the deck behaviour (lib/islands/deck RAIL_THUMB_ATTR, the same name). */
const RAIL_THUMB_ATTR = 'data-mx-thumb';
/** The deck's framework-free behaviour chunk, by its manifest specifier. */
const DECK_BEHAVIOR = '@mx/deck';
/** A rail miniature part's kind (`previewOf`). */
const P = { NONE_K: 0, TEXT: 1, LIT: 2, HOLE_TEXT: 3, ELEMENT: 4, COMPONENT: 5 } as const;

/* ────────────────────────────────────────────────────────────────────────────
 * Static HTML → JSX
 * ──────────────────────────────────────────────────────────────────────────── */

// Keep literal DOM attributes in JSX so Solid can optimize static elements.
// Entity encoding keeps author text inert in generated source.
const jsxLiteral = (value: string): string => escapeHtml(value).replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/\u2028/g, '&#8232;').replace(/\u2029/g, '&#8233;');
/* ────────────────────────────────────────────────────────────────────────────
 * Which nodes need the browser
 * ──────────────────────────────────────────────────────────────────────────── */

const isElement = (node: JsxNode): node is JsxElement => node.type === 'element';

/** Does this node itself need the browser? */
/**
 * A capitalized tag outside the registry is a component the document's SCRIPT exports (validated at publish against
 * the built module's exports): the compiler emits its mount node, with its props as data and its children as the
 * server-rendered fallback, and the page runtime renders the component into it (lib/islands/page-runtime). The
 * predicate and the attribute live in lib/story-runtime/script-mount, which the editor reads too.
 */
/** The mount's props (literal JSON), its bindings (prop → declared name) and the DOM attributes the node keeps. */
function mountParts(node: JsxElement): { props: Record<string, unknown>; bind: Record<string, string>; id?: string; cls?: string } {
  const props: Record<string, unknown> = {};
  const bind: Record<string, string> = {};
  let id: string | undefined, cls: string | undefined;
  for (const a of node.attributes) {
    if (!a.value.static) { if (a.value.reactive?.kind === 'signal') bind[a.name] = a.value.reactive.name; continue; }
    const v = a.value.json;
    if (a.name === 'id' && typeof v === 'string') { id = v; continue; }
    if ((a.name === 'className' || a.name === 'class') && typeof v === 'string') { cls = v; continue; }
    const ref = typeof v === 'string' ? refName(v) : null;
    if (ref) bind[a.name] = ref; else props[a.name] = v;
  }
  return { props, bind, ...(id !== undefined ? { id } : {}), ...(cls !== undefined ? { cls } : {}) };
}

function selfDynamic(node: JsxNode): boolean {
  if (node.type === 'text') return false;
  if (node.type === 'expression') return !node.value.static;
  if (node.control) return node.control.kind !== 'fragment';
  if (node.tag === 'For') return true;
  // A mount is static markup: its bindings are data the runtime reads, never an island's.
  if (isScriptComponent(node)) return false;
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

type Mode = 'static' | 'browser';
interface IslandBuild { id: number; path: string; source: string; kit: Set<string>; readsData: boolean }
interface Ctx {
  /** The JS name of the row in scope (inside a `<For>`), and its scope's. */
  row: string | null;
  scope?: string;
  svg?: boolean;
  selectValue?: string | null;
  grid?: { cols: number; flow: boolean };
  /** Inside a DataTable column's content: `scope` names the row's CellScope, and attributes resolve through `cellAttrs`. */
  cell?: boolean;
  /** The deck rail's thumbnail decoration. */
  preview?: { rewrite: (props: Props) => Props; values: Record<string, Scalar> };
  /** The island being emitted, for its kit accounting. */
  island?: IslandBuild;
  /** Structural kit descendants of a live component must remain hydratable. */
  liveKit?: boolean;
  /** The subtree may be created after the first hydration (a conditional branch). */
  branch?: boolean;
}

/** What one generation produced: the sources and what they used. */
export interface Generated extends GeneratedSources {
  browserIslands: string;
  moduleData: string[];
  staticTexts: Record<string, string>;
  /** The skeleton's pre-rendered static chunks: `$mxH[i]` in the skeleton is `staticHtml[i]` (bundle.server `ssrModuleCode`). */
  staticHtml: string[];
  islandRefs: IslandRef[];
  kit: { skeleton: string[]; islands: string[] };
  reactStatic: string[];
  unported: string[];
  partial: string[];
  behaviors: string[];
}

/** One version's facts the generator reads (CompileInput without the build). */
type GenerateInput = Omit<CompileInput, 'build'> & {
  glyphCatalogUrl?: string;
  /** Render static plain-HTML subtrees here (the default); `false` keeps every one as JSX (the parity tests' reference). */
  staticHtml?: boolean;
  /** The shared build's server kit (bundle.server `loadKitServer`): static kit subtrees render here too. Absent, they keep their JSX. */
  kitServer?: KitServer;
};

export function generate(input: GenerateInput): Generated {
  const elementAttrs = reactAttrs;
  const markdownAttrs = (node: JsxElement, path: string): Attr[] => {
    const props = rawBuildProps(node.attributes, true, node.tag, path);
    return elementAttrs('div', { ...props, 'data-mx-markdown': '', className: cn('mx-markdown', typeof props.className === 'string' ? props.className : '') });
  };
  const jsxAttrs = (attrs: Attr[]): string => attrs.map(([n, v]) => ` ${safeAttr(n)}={${v === '' && /^(?:disabled|checked|selected|readOnly|hidden|open|multiple|required|inert|autoFocus|reversed)$/i.test(n) ? 'true' : lit(v)}}`).join('');
  const refData = input.refData ?? {};
  const nodes = input.nodes ?? [];
  const partial = new Set<string>();
  const unported = new Set<string>();
  const kitUsed = { skeleton: new Set<string>(), islands: new Set<string>() };
  const staticTexts: Record<string, string> = {};
  const staticHtml: string[] = [];
  const staticText = (value: string, noHydration = false): string => {
    if (value.length <= 1024) return jsxLiteral(value);
    const marker = `${noHydration ? 'MXSTATICTEXT' : 'MXSTATIC'}${contentSha(value)}${Object.keys(staticTexts).length}END`;
    staticTexts[marker] = value;
    return marker;
  };
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
  const needs = new WeakMap<JsxNode, boolean>();
  const needsBrowser = (node: JsxNode): boolean => {
    const known = needs.get(node);
    if (known !== undefined) return known;
    const value = selfDynamic(node) || (isElement(node) && node.children.some(needsBrowser));
    needs.set(node, value);
    return value;
  };

  // Structured author data never becomes an object literal: each value is a module constant parsed
  // from a string literal — one per emission site, never shared by content, so the module's shape
  // depends on the tree alone.
  const data: string[] = [];
  const json = (value: unknown): string => {
    data.push(JSON.stringify(value === undefined ? null : value));
    return `$d${data.length - 1}`;
  };
  const useKit = (tag: string, mode: Mode, ctx: Ctx): void => {
    (mode === 'browser' ? kitUsed.islands : kitUsed.skeleton).add(tag);
    ctx.island?.kit.add(tag);
  };

  /** Emit one node as a JSX child. */
  function emit(node: JsxNode, path: string, mode: Mode, ctx: Ctx): string {
    if (node.type === 'text') {
      if (ctx.row && /\{\s*\$_row\./.test(node.value)) return `{rt.sub(${lit(node.value)}, ${ctx.row})}`;
      if (!ctx.row && !ctx.preview && !ctx.branch && node.value) return mode === 'browser' ? '<rt.NoHydration />' : `<rt.NoHydration>${node.value.length <= 1024 && /\r|\n/.test(node.value) ? `{${lit(node.value)}}` : staticText(node.value, true)}</rt.NoHydration>`;
      return node.value === '' ? '' : (node.value.length <= 1024 && /\r|\n/.test(node.value) ? `{${lit(node.value)}}` : staticText(node.value));
    }
    if (node.type === 'expression') {
      if (!node.value.static) {
        if (ctx.preview) {
          const value = isReactiveExpression(node.value.reactive) ? evaluateReactive(node.value.reactive, ctx.preview.values, undefined) : null;
          return typeof value === 'string' || typeof value === 'number' ? `{${lit(String(value))}}` : '';
        }
        if (isReactiveExpression(node.value.reactive)) return `{rt.text(${json(node.value.reactive)}, ${ctx.row ?? 'undefined'})}`;
        const field = ctx.row ? /^\s*\$_row\.([A-Za-z_]\w*)\s*$/.exec(node.source)?.[1] : null;
        return field ? `{String(${ctx.row}[${lit(field)}] ?? '')}` : '';
      }
      const v = node.value.json;
      return typeof v === 'string' || typeof v === 'number' ? ctx.branch ? `{${lit(String(v))}}` : mode === 'browser' ? '<rt.NoHydration />' : `<rt.NoHydration>{${lit(String(v))}}</rt.NoHydration>` : '';
    }
    if (node.control) {
      if (node.control.kind === 'fragment') return `<>${node.children.map((c, i) => emit(c, `${path}.${i}`, mode, ctx)).join('')}</>`;
      if (!isReactiveExpression(node.control.test) || node.children.length !== 2) return '';
      if (ctx.preview) {
        const yes = Boolean(evaluateReactive(node.control.test, ctx.preview.values));
        return node.control.kind === 'and' && !yes ? '' : emit(node.children[yes ? 0 : 1]!, `${path}.${yes ? 0 : 1}`, mode, ctx);
      }
      const yes = emit(node.children[0]!, `${path}.0`, mode, { ...ctx, branch: true });
      const no = emit(node.children[1]!, `${path}.1`, mode, { ...ctx, branch: true });
      return `<rt.When test={${json(node.control.test)}} row={${ctx.row ?? 'undefined'}}${node.control.kind === 'conditional' ? ` fallback={<>${no}</>}` : ''}>{<>${yes}</>}</rt.When>`;
    }
    if (INERT.has(node.tag)) return '';
    // Both builds keep the same tree of hydration boundaries. Static descendants are
    // server markup only; the browser emits an empty boundary at the same position.
    // A live control is emitted as a sibling of these boundaries, never inside one.
    // A branch absent from SSR must carry its static descendants in the browser to appear later.
    if (!ctx.preview && !ctx.row && !ctx.branch && !needsBrowser(node) && !(ctx.liveKit && !!KIT[node.tag])) {
      if (mode === 'browser') return '<rt.NoHydration />';
      const html = input.staticHtml === false ? null : htmlOf(node, path, ctx);
      // An index, never the content: a draft that edits static text leaves the module Babel sees unchanged.
      if (html !== null) return staticChunkJsx(staticHtml.push(html) - 1);
      return `<rt.NoHydration>${emitElement(node, path, mode, ctx)}</rt.NoHydration>`;
    }
    const live = selfDynamic(node) || !!ctx.liveKit && !!KIT[node.tag];
    const element = emitElement(node, path, mode, { ...ctx, liveKit: ctx.liveKit || !!KIT[node.tag] && live });
    return element;
  }

  /**
   * What `emit` would render for a child of a static plain element, as Solid renders it under `NoHydration`:
   * `{ html, counts }` (`counts`: it is a JSX child, so it takes part in the child-run boxing), or null when
   * it keeps its JSX. Mirrors `emit` for the static branch only (static-solid/html holds the byte rules).
   */
  function childHtmlOf(node: JsxNode, path: string, ctx: Ctx): { html: string; counts: boolean } | null {
    if (node.type === 'text') {
      if (!node.value) return { html: '', counts: false };
      return { html: solidTextChild(node.value), counts: true };
    }
    if (node.type === 'expression') {
      if (!node.value.static) return null;
      const v = node.value.json;
      return typeof v === 'string' || typeof v === 'number' ? { html: solidText(String(v)), counts: true } : { html: '', counts: false };
    }
    if (node.control) return null;
    if (INERT.has(node.tag)) return { html: '', counts: false };
    if (needsBrowser(node)) return null;
    const html = htmlOf(node, path, ctx);
    return html === null ? null : { html, counts: true };
  }

  /**
   * A static element's server HTML (see SOLID_BOOLEAN), or null when it keeps its JSX. Memoized: a JSX fallback
   * re-asks its children. A kit component's JSX hoists its object props to module constants (`json`), which number
   * the browser module's: a rendered subtree keeps the constants its JSX would have made, in the same order, and a
   * subtree that falls back to JSX keeps none (its JSX makes them) — each time a memoized one is used, it makes them again.
   */
  const htmlMemo = new WeakMap<JsxElement, { html: string | null; data: string[] }>();
  function htmlOf(node: JsxElement, path: string, ctx: Ctx): string | null {
    let known = htmlMemo.get(node);
    if (!known) {
      const mark = data.length;
      const html = renderHtml(node, path, ctx);
      known = { html, data: data.splice(mark) };
      htmlMemo.set(node, known);
    }
    if (known.html !== null) data.push(...known.data);
    return known.html;
  }
  /** A static kit component's server HTML (`KIT_CHUNK`), from the build's server kit; null when it keeps its JSX. */
  /** A script component's mount as static HTML: the node, its data, and its children as the fallback. */
  function mountHtml(node: JsxElement, path: string, ctx: Ctx): string | null {
    const { props, bind, id, cls } = mountParts(node);
    const attrs: Array<[string, string]> = [[MOUNT_ATTR, node.tag], ['data-mx-props', JSON.stringify(props)], ['data-mx-bind', JSON.stringify(bind)]];
    if (id !== undefined) attrs.push(['id', id]);
    if (cls !== undefined) attrs.push(['class', cls]);
    const attrHtml = solidAttrs(attrs, safeAttr);
    if (attrHtml === null) return null;
    const parts: string[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const child = childHtmlOf(node.children[i]!, `${path}.${i}`, ctx);
      if (child === null) return null;
      if (child.counts) parts.push(child.html);
    }
    return `<div${attrHtml}>${solidChildren(parts)}</div>`;
  }
  /** The same mount inside an island's JSX. */
  function mountJsx(node: JsxElement, path: string, mode: Mode, ctx: Ctx): string {
    const { props, bind, id, cls } = mountParts(node);
    const children = node.children.map((c, i) => emit(c, `${path}.${i}`, mode, ctx)).join('');
    const idJsx = id !== undefined ? ` id={${lit(id)}}` : '';
    const clsJsx = cls !== undefined ? ` class={${lit(cls)}}` : '';
    return `<div ${MOUNT_ATTR}={${lit(node.tag)}} data-mx-props={${lit(JSON.stringify(props))}} data-mx-bind={${lit(JSON.stringify(bind))}}${idJsx}${clsJsx}>${children}</div>`;
  }
  function kitHtml(node: JsxElement, path: string, ctx: Ctx): string | null {
    if (!input.kitServer || ctx.liveKit || !KIT_CHUNK.has(node.tag)) return null;
    if (node.attributes.some((a) => !a.value.static)) return null;
    const meta = node.tag === 'Progress' ? { ...KIT.Progress!, mod: 'static' } : KIT[node.tag];
    const component = meta && input.kitServer[meta.mod]?.[node.tag];
    if (!meta || typeof component !== 'function') return null;
    useKit(node.tag, 'static', ctx);
    const parts = kitParts(node, path, 'static', ctx, meta);
    if (typeof parts === 'string') return null;
    // Keyed in the JSX's order: the API props, the class, the DOM attributes (`emitElement`).
    const props: Props = {};
    for (const [k, v] of Object.entries(parts.api)) {
      safeAttr(k);
      if (typeof v === 'string') props[k] = v;
      else { json(v); props[k] = JSON.parse(data[data.length - 1]!); }
    }
    if (parts.cls) props.class = parts.cls;
    for (const [n, v] of parts.attrs) props[safeAttr(n)] = v === '' && /^(?:disabled|checked|selected|readOnly|hidden|open|multiple|required|inert|autoFocus|reversed)$/i.test(n) ? true : v;
    const children: unknown[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const child = node.children[i]!;
      if (child.type === 'text') { if (child.value) children.push(solidTextValue(child.value)); continue; }
      if (child.type === 'expression') {
        if (!child.value.static) return null;
        const v = child.value.json;
        if (typeof v === 'string' || typeof v === 'number') children.push(String(v));
        continue;
      }
      const html = childHtmlOf(child, `${path}.${i}`, ctx);
      if (html === null) return null;
      if (html.counts) children.push({ t: html.html });
    }
    return kitServerHtml(component, props, children);
  }
  function renderHtml(node: JsxElement, path: string, ctx: Ctx): string | null {
    if (node.control || ctx.preview || ctx.row || ctx.cell || ctx.branch) return null;
    if (node.tag === 'Markdown') {
      const attrs = solidAttrs(markdownAttrs(node, path), safeAttr);
      return attrs === null ? null : `<div${attrs}>${markdownContent(markdownSource(node) ?? '').html}</div>`;
    }
    if (node.tag === 'Grid' || node.tag === 'GridItem') return gridHtml(node, path, ctx);
    if (node.isComponent) return isScriptComponent(node) ? mountHtml(node, path, ctx) : kitHtml(node, path, ctx);
    const lower = node.tag.toLowerCase();
    if (SOLID_SPECIAL_TAGS.has(lower)) return null;
    const tag = safeTag(SVG_TAG_CASE[lower] ?? lower);
    if (node.attributes.some((a) => !a.value.static)) return null;
    const source = lower === 'img' ? node.attributes.find((a) => a.name.toLowerCase() === 'src') : undefined;
    if (source?.value.static && typeof source.value.json === 'string' && (refName(source.value.json) || parseRowRef(source.value.json) || carriesRef(source.value.json))) return null;
    const boundTable = ['input', 'select', 'textarea'].includes(lower) ? REF_ATTRS.html[lower] : null;
    if (boundTable && node.attributes.some((a) => boundTable[a.name.toLowerCase()] && a.value.static && refName(a.value.json))) return null;
    let props = rawBuildProps(node.attributes, false, node.tag, path, undefined, {});
    const patch = resolveRefProps(node, props, refData);
    if (patch) props = { ...props, ...patch };
    const selectedValue = lower === 'select' ? props.defaultValue ?? props.value : undefined;
    const inner = lower === 'svg' ? { ...ctx, svg: true } : selectedValue !== undefined ? { ...ctx, selectValue: String(selectedValue) } : ctx;
    const attrs = elementAttrs(tag, props);
    if (lower === 'option' && ctx.selectValue !== undefined) {
      const value = props.value ?? node.children.map((child) => child.type === 'text' ? child.value : '').join('');
      const i = attrs.findIndex(([name]) => name === 'selected');
      if (i >= 0) attrs.splice(i, 1);
      if (String(value) === ctx.selectValue) attrs.push(['selected', '']);
    }
    const attrHtml = solidAttrs(attrs, safeAttr);
    if (attrHtml === null) return null;
    const open = `<${tag}${attrHtml}>`;
    if (VOID.test(lower)) return open;
    if (lower === 'textarea' && (props.defaultValue !== undefined || props.value !== undefined)) return `${open}${solidText(String(props.defaultValue ?? props.value))}</${tag}>`;
    const parts: string[] = [];
    for (let i = 0; i < node.children.length; i++) {
      const child = childHtmlOf(node.children[i]!, `${path}.${i}`, inner);
      if (child === null) return null;
      if (child.counts) parts.push(child.html);
    }
    return `${open}${solidChildren(parts)}</${tag}>`;
  }

  /**
   * A kit component's props as `emitElement` hands them to it (its API props, its recipe class, its DOM attributes),
   * or the JSX that stands in for it. Shared with the static chunks (`kitHtml`), which call the component itself.
   */
  function kitParts(node: JsxElement, path: string, mode: Mode, ctx: Ctx, meta: KitMeta) {
    const props = rawBuildProps(node.attributes, true, node.tag, path, undefined, ctx.preview?.values ?? {});
    if (!ctx.preview && ['TabsContent', 'AccordionContent', 'CollapsibleContent', 'PopoverContent', 'TooltipContent'].includes(node.tag)) props.forceMount = true;
    if (ctx.preview) Object.assign(props, ctx.preview.rewrite(props));
    if (node.tag === 'File') Object.assign(props, resolveRefProps(node, props, refData));
    // Decided here, never read from the author (interpreter BUTTON_TRIGGERS).
    if (node.tag === 'DialogTrigger' || node.tag === 'DialogClose') props.wrapsControl = wrapsControl(node);
    // The dialog stacks its fields (and its mutation form is `display:contents`) only without an author class.
    if (node.tag === 'DialogContent') props.stacked = !(typeof props.className === 'string' && props.className);
    // The runtime registry hands Mermaid the document's colour mode.
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
        cellsJsx = emitCells(columns, path, mode, ctx);
      }
    }
    if (node.tag === 'Files' || node.tag === 'Icon') props.glyphs = glyphs;
    if (node.tag === 'Icon' && input.glyphCatalogUrl) props.catalogUrl = input.glyphCatalogUrl;
    // The runtime hands the map the document's colour mode.
    if (node.tag === 'DeckGL') props.colorMode = input.colorMode ?? 'light';
    const classes = peopleClasses(node.tag, props);
    if (classes) props.classes = classes;
    const viz = props.viz as { recipe?: unknown } | undefined;
    if (node.tag === 'Question' && typeof viz?.recipe === 'string' && viz.recipe.startsWith('ref:')) props.recipeData = refData[viz.recipe.slice(4)] ?? null;
    const api: Props = Object.fromEntries((meta.api ?? []).filter((k) => props[k] !== undefined).map((k) => [k, props[k]]));
    // Class strings come from the recipes index AT COMPILE TIME: readers never download cva or tailwind-merge.
    const recipe = RECIPES[node.tag];
    // In a fixed grid's tile the tile owns the size: the recipe and the port both know.
    const inGrid = !!(meta.grid && ctx.grid && !ctx.grid.flow);
    const cls = meta.dom === 'identity' ? null : node.tag === 'Icon' ? cn(ICON_BASE_CLASS, typeof props.className === 'string' ? props.className : undefined) : recipe ? cn(recipe({ ...props, ...(inGrid ? { inGridItem: true } : {}) })) : typeof props.className === 'string' ? props.className : null;
    let dom: Props = { ...props };
    for (const k of [...(meta.api ?? []), 'className']) delete dom[k];
    if (meta.dom) dom = Object.fromEntries(Object.entries(dom).filter(([k]) => k === 'id' || k === AST || k === SOURCE_NODE_ID_ATTR || (node.tag === 'DataTable' && k.startsWith('data-'))));
    // A `<Question>`'s chart box: the assembler puts the snapshot's drawing inside it (contract CHART_SLOT_ATTR).
    if (node.tag === 'Question') dom[CHART_SLOT_ATTR] = typeof dom.id === 'string' && dom.id ? dom.id : path;
    if (inGrid) api.inGridItem = true;
    const attrs = elementAttrs('div', dom).filter(([n]) => n !== 'class');
    return { props, api, recipe, inGrid, cls, attrs, cellsJsx };
  }

  function emitElement(node: JsxElement, path: string, mode: Mode, ctx: Ctx): string {
    const children = (inner: Ctx = ctx): string => node.children.map((c, i) => emit(c, `${path}.${i}`, mode, inner)).join('');
    if (node.tag === 'Markdown') return `<div${jsxAttrs(markdownAttrs(node, path))} innerHTML={${lit(markdownContent(markdownSource(node) ?? '').html)}} />`;
    if (node.tag === 'For') return emitFor(node, path, mode, ctx);
    if (node.tag === 'Grid' || node.tag === 'GridItem') return emitGrid(node, path, mode, ctx);
    // A control with `run` in a column's content is an editing cell (interpreter renderNode → cellControl).
    const run = node.attributes.find((a) => a.name === 'run');
    if (ctx.cell && node.tag !== 'Button' && run?.value.static && typeof run.value.json === 'string' && refName(run.value.json)) {
      const cellTag = node.isComponent ? node.tag : node.tag.toLowerCase();
      if (CELL_CONTROLS.has(cellTag)) return emitCellControl(node, cellTag, path, mode, ctx);
      if (!node.isComponent) return '';
    }
    if (ctx.preview && PREVIEW_EMBEDS[node.tag]) return `<div${jsxAttrs(elementAttrs('div', { style: PREVIEW_STYLE }))}>{${lit(PREVIEW_EMBEDS[node.tag])}}</div>`;
    if (ctx.preview && (node.tag === 'Input' || node.tag === 'Select' || node.tag === 'Switch' || node.tag === 'FileUpload')) {
      const previewTag = `Preview${node.tag}`;
      useKit(previewTag, mode, ctx);
      const props = ctx.preview.rewrite(rawBuildProps(node.attributes, true, node.tag, path, undefined, ctx.preview.values));
      return `<${previewTag} p={${json(props)}} />`;
    }
    if (isScriptComponent(node)) return mountJsx(node, path, mode, ctx);
    if (node.isComponent) {
      const meta = node.tag === 'Progress' ? { ...KIT.Progress!, mod: 'static' } : KIT[node.tag];
      if (!meta) {
        unported.add(node.tag);
        const id = node.attributes.find((a) => a.name.toLowerCase() === 'id')?.value;
        const witness = id?.static && typeof id.json === 'string' && id.json ? ` data-mx-source-node-id={${lit(id.json)}}` : '';
        return `<div data-mx-unported={${lit(node.tag)}} data-mx-ast={${lit(path)}}${witness}></div>`;
      }
      useKit(node.tag, mode, ctx);
      const parts = kitParts(node, path, mode, ctx, meta);
      if (typeof parts === 'string') return parts;
      const { props, api, recipe, inGrid, cls, attrs, cellsJsx } = parts;
      const apiJsx = Object.entries(api).map(([k, v]) => ` ${safeAttr(k)}={${typeof v === 'string' ? ctx.row ? `rt.sub(${lit(v)}, ${ctx.row})` : lit(v) : json(v)}}`).join('');
      const authorClass = typeof props.className === 'string' ? props.className : '';
      const rowClass = !!ctx.row && !!authorClass;
      if (rowClass) usesRowClass = true;
      const rowBase = rowClass ? node.tag === 'Icon' ? ICON_BASE_CLASS : recipe ? cn(recipe({ ...props, className: undefined, ...(inGrid ? { inGridItem: true } : {}) })) : '' : '';
      const clsJsx = rowClass
        ? ` class={$rowClass(${lit(rowBase)}, ${lit(authorClass)}, ${ctx.row})}`
        : cls ? ` class={${lit(cls)}}` : '';
      const tag = safeTag(node.tag === 'Skeleton' ? 'StaticSkeleton' : node.tag);
      // A row action writes with its row (a Button with `run`/`set`).
      const rowJsx = node.tag === 'Button' && (api.run !== undefined || api.set !== undefined) ? ` row={${ctx.row}} rowScope={${ctx.scope}}` : '';
      if (ctx.row) return `<${tag}${apiJsx}${rowJsx}${clsJsx} {...${rowAttrsFn(mode, ctx)}(${json(Object.fromEntries(attrs))}, ${ctx.row}, ${ctx.scope})}>${children()}</${tag}>`;
      return `<${tag}${apiJsx}${cellsJsx}${clsJsx}${jsxAttrs(attrs)}>${meta.noChildren ? '' : children()}</${tag}>`;
    }
    const lower = node.tag.toLowerCase();
    const tag = safeTag(SVG_TAG_CASE[lower] ?? lower);
    // Values and row references share one image island; row attributes are substituted first.
    const source = lower === 'img' && !node.isComponent ? node.attributes.find((a) => a.name.toLowerCase() === 'src') : undefined;
    if (source?.value.static && typeof source.value.json === 'string'
      && (refName(source.value.json) || parseRowRef(source.value.json) || carriesRef(source.value.json))) {
      if (ctx.preview) {
        const rest = rawBuildProps(node.attributes.filter((a) => a !== source), false, node.tag, path, undefined, ctx.preview.values);
        return `<img${jsxAttrs(elementAttrs('img', { ...rest, 'data-mx-bound': `src:${source.value.json}` }))} />`;
      }
      useKit('BoundImage', mode, ctx);
      const props = rawBuildProps(node.attributes.filter((a) => a !== source), false, node.tag, path, undefined, {});
      const attrs = json(Object.fromEntries(elementAttrs(tag, props)));
      return `<BoundImage template={${lit(source.value.json)}} props={${ctx.row ? `${rowAttrsFn(mode, ctx)}(${attrs}, ${ctx.row}, ${ctx.scope})` : attrs}}${ctx.row ? ` row={${ctx.row}}` : ''} />`;
    }
    // A `$`-bound native form control (interpreter boundAttrs).
    const boundTable = ['input', 'select', 'textarea'].includes(lower) ? REF_ATTRS.html[lower] : null;
    const boundAttrs = boundTable ? node.attributes.filter((a) => boundTable[a.name.toLowerCase()] && a.value.static && refName(a.value.json)) : [];
    if (boundAttrs.length) {
      if (ctx.preview) {
        const bind = Object.entries(Object.fromEntries(boundAttrs.map((a) => [a.name.toLowerCase(), refName(a.value.static ? a.value.json : null)])))
          .map(([name, value]) => `${name}:$${value}`).join(' ');
        const props = rawBuildProps(node.attributes.filter((a) => !boundAttrs.includes(a)), false, node.tag, path, undefined, ctx.preview.values);
        const attrs = jsxAttrs(elementAttrs(tag, { ...props, disabled: true, 'data-mx-bound': bind }));
        return VOID.test(lower) ? `<${tag}${attrs} />` : `<${tag}${attrs}>${children()}</${tag}>`;
      }
      useKit('BoundNative', mode, ctx);
      const bind = Object.fromEntries(boundAttrs.map((a) => [a.name.toLowerCase(), refName(a.value.static ? a.value.json : null)]));
      const props = rawBuildProps(node.attributes.filter((a) => !boundAttrs.includes(a)), false, node.tag, path, undefined, {});
      return `<BoundNative tag={${lit(lower)}} bind={${json(bind)}}${jsxAttrs(elementAttrs(tag, props))}>${children()}</BoundNative>`;
    }
    let props = rawBuildProps(node.attributes, false, node.tag, path, undefined, ctx.preview?.values ?? {});
    const patch = resolveRefProps(node, props, refData);
    if (patch) props = { ...props, ...patch };
    if (ctx.preview) props = ctx.preview.rewrite(props);
    // A static wrapper with live descendants is already served. Its id may be minted
    // anew by an edit; leaving it to the DOM keeps the browser module reusable.
    if (mode === 'browser' && !ctx.row && !ctx.liveKit && !ctx.branch && !selfDynamic(node) && needsBrowser(node)) {
      delete props.id;
      // The served skeleton owns this wrapper's stable identity. The browser module must not
      // capture it, or a prose-only version change changes the reusable island module hash.
      // Omitting it here also leaves the server-rendered witness in place during hydration.
      delete props[SOURCE_NODE_ID_ATTR];
    }
    const selectedValue = lower === 'select' ? props.defaultValue ?? props.value : undefined;
    const inner = lower === 'svg' ? { ...ctx, svg: true } : selectedValue !== undefined ? { ...ctx, selectValue: String(selectedValue) } : ctx;
    const reactive = ctx.preview ? [] : node.attributes.filter((a) => !a.value.static && REACTIVE_BOOLEAN_PROPS.has(a.name) && isReactiveExpression(a.value.reactive));
    const reactiveNames = new Set(reactive.map((a) => a.name.toLowerCase()));
    const attrs = elementAttrs(tag, props).filter(([name]) => !reactiveNames.has(name.toLowerCase()));
    if (lower === 'option' && ctx.selectValue !== undefined) {
      const value = props.value ?? node.children.map((child) => child.type === 'text' ? child.value : '').join('');
      const i = attrs.findIndex(([name]) => name === 'selected');
      if (i >= 0) attrs.splice(i, 1);
      if (String(value) === ctx.selectValue) attrs.push(['selected', '']);
    }
    const booleanJsx = reactive.map((a) => ` {...(rt.expr(${json(a.value.static ? null : a.value.reactive)}, ${ctx.row ?? 'undefined'}) ? { ${safeAttr(a.name)}: true } : {})}`).join('');
    if (ctx.row && lower === 'img') (mode === 'static' ? kitUsed.skeleton : kitUsed.islands).add('rowImageAttrs');
    const rowAttrs = ctx.row ? `${rowAttrsFn(mode, ctx)}(${json(Object.fromEntries(attrs))}, ${ctx.row}, ${ctx.scope})` : '';
    const open = ctx.row ? `<${tag} {...${lower === 'img' ? `rowImageAttrs(${rowAttrs})` : rowAttrs}}${booleanJsx}>` : `<${tag}${jsxAttrs(attrs)}${booleanJsx}>`;
    if (VOID.test(lower)) return open.replace(/>$/, ' />');
    if (lower === 'textarea' && (props.defaultValue !== undefined || props.value !== undefined)) return `${open}{${lit(String(props.defaultValue ?? props.value))}}</${tag}>`;
    const content = children(inner);
    return `${open}${content}</${tag}>`;
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
  function emitCells(columns: ReadonlyArray<readonly [JsxElement, number]>, path: string, mode: Mode, ctx: Ctx): string {
    const fns = columns.map(([column, i]) => {
      if (!hasContent(column.children)) return 'undefined';
      const cpath = `${path}.${i}`;
      const suffix = cpath.replace(/\./g, '_');
      const inner: Ctx = { row: `row${suffix}`, scope: `cell${suffix}`, cell: true, svg: false, island: ctx.island };
      return `(${inner.row}, ${inner.scope}) => <>${column.children.map((c, k) => emit(c, `${cpath}.${k}`, mode, inner)).join('')}</>`;
    });
    return fns.some((f) => f !== 'undefined') ? ` cells={[${fns.join(', ')}]}` : '';
  }

  /**
   * The editing cell. What differs per row — the row's values, the
   * scope, the draft, the write check — is resolved by `CellControl`; everything authored is decided here: the element's attributes serialised with React's attribute rules
   * (static-solid/attrs.ts, kept for byte parity with stored pages), and its class merged by the kit's
   * merger (order included).
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
      attrs = elementAttrs('div', shellRest(rest));
      cls = cn('mx-control relative inline-flex flex-col gap-1.5 align-top', cn('flex w-full min-w-0', author));
    } else {
      attrs = elementAttrs(tag, rest);
      cls = cn(NATIVE_CELL, tag === 'textarea' ? 'min-h-8 resize-y' : 'h-8', props.type === 'number' && 'text-right tabular-nums', author);
    }
    const children = node.children.map((c, i) => emit(c, `${path}.${i}`, mode, ctx)).join('');
    return `<CellControl tag={${lit(tag)}} run={${lit(refName(run))}}${field ? ` field={${lit(field)}}` : ''} p={${json(api)}} attrs={${json(Object.fromEntries(attrs.filter(([n]) => n !== 'class')))}} cls={${lit(cls)}} path={${lit(path)}} row={${ctx.row}} cell={${ctx.scope}}>${children}</CellControl>`;
  }

  /**
   * Grid/GridItem are compile-time macros: layout arithmetic done here, plain HTML out. A Grid is two boxes, its
   * GridItems (nothing else) the inner box's children; a GridItem is one box around its children.
   */
  function gridParts(node: JsxElement, path: string, ctx: Ctx): { attrs: Attr[]; inner: string | null; kids: Array<[JsxNode, string, Ctx]> } {
    const raw = rawBuildProps(node.attributes, true, node.tag, path, undefined, ctx.preview?.values ?? {});
    const props = ctx.preview ? ctx.preview.rewrite(raw) : raw;
    const { className, style, cols, rowHeight, mode: gridMode, x, y, w, h, minHeight, editing: _editing, ...rest } = props;
    const styleObject = (style && typeof style === 'object' ? style : {}) as Props;
    const classString = typeof className === 'string' ? className : undefined;
    if (node.tag === 'Grid') {
      const nCols = gridCols(cols);
      const rh = gridRowHeight(rowHeight);
      const items = node.children.flatMap((c, i) => (isElement(c) && c.tag === 'GridItem' ? [[c, i] as const] : []));
      const rows = gridRows(items.map(([c]) => gridItemRect(rawBuildProps(c.attributes, true, 'GridItem', '', undefined, {}) as Parameters<typeof gridItemRect>[0], nCols)));
      const flow = gridMode === 'flow';
      const attrs = elementAttrs('div', { className: cn('@container w-full', classString), style: { ...styleObject, '--g-cols': String(nCols), '--g-rh': `${rh}px`, '--g-rows': String(rows) }, ...rest });
      const inner = flow ? 'grid w-full grid-cols-[repeat(var(--g-cols),minmax(0,1fr))] items-start @max-2xl:grid-cols-1' : 'relative w-full h-[calc(var(--g-rows)*var(--g-rh))] @max-2xl:h-auto';
      const kids = items.map(([c, i]): [JsxNode, string, Ctx] => [c, `${path}.${i}`, { ...ctx, grid: { cols: nCols, flow } }]);
      return { attrs, inner, kids };
    }
    const flow = ctx.grid?.flow ?? false;
    const nCols = ctx.grid?.cols ?? 12;
    const rect = gridItemRect({ x, y, w, h } as Parameters<typeof gridItemRect>[0], nCols);
    const cls = cn(flow ? 'min-w-0 p-[3px] col-span-[var(--gi-w)] min-h-[var(--gi-min-h)] @max-2xl:col-span-1' : 'overflow-hidden p-[3px]', flow ? 'relative' : 'absolute left-[calc(var(--gi-x)/var(--g-cols)*100%)] top-[calc(var(--gi-y)*var(--g-rh))] w-[calc(var(--gi-w)/var(--g-cols)*100%)] h-[calc(var(--gi-h)*var(--g-rh))] @max-2xl:static @max-2xl:w-full', classString);
    const minH = flow && typeof minHeight === 'number' && Number.isFinite(minHeight) ? Math.max(0, Math.min(10000, minHeight)) : 0;
    const attrs = elementAttrs('div', { className: cls, style: { ...styleObject, '--gi-min-h': `${minH}px`, '--gi-x': String(rect.x), '--gi-y': String(rect.y), '--gi-w': String(rect.w), '--gi-h': String(rect.h) }, ...rest });
    return { attrs, inner: null, kids: node.children.map((c, i): [JsxNode, string, Ctx] => [c, `${path}.${i}`, ctx]) };
  }
  function emitGrid(node: JsxElement, path: string, mode: Mode, ctx: Ctx): string {
    const { attrs, inner, kids } = gridParts(node, path, ctx);
    const content = kids.map(([c, p, kidCtx]) => emit(c, p, mode, kidCtx)).join('');
    return inner === null ? `<div${jsxAttrs(attrs)}>${content}</div>` : `<div${jsxAttrs(attrs)}><div class={${lit(inner)}}>${content}</div></div>`;
  }
  /** A static Grid/GridItem's server HTML, as Solid serves `emitGrid`'s JSX under `NoHydration`; null when it keeps its JSX. */
  function gridHtml(node: JsxElement, path: string, ctx: Ctx): string | null {
    if (node.attributes.some((a) => !a.value.static)) return null;
    const { attrs, inner, kids } = gridParts(node, path, ctx);
    const attrHtml = solidAttrs(attrs, safeAttr);
    const innerHtml = inner === null ? '' : solidAttrs([['class', inner]], safeAttr);
    if (attrHtml === null || innerHtml === null) return null;
    const parts: string[] = [];
    for (const [c, p, kidCtx] of kids) {
      const child = childHtmlOf(c, p, kidCtx);
      if (child === null) return null;
      if (child.counts) parts.push(child.html);
    }
    const content = solidChildren(parts);
    return inner === null ? `<div${attrHtml}>${content}</div>` : `<div${attrHtml}><div${innerHtml}>${content}</div></div>`;
  }

  /**
   * RAIL MINIATURES AS STATIC CHUNKS. What `emit` writes for a node in the deck rail's preview context, as Solid's
   * server renders that JSX: the rail sits under `NoHydration`, so its native elements are inline template text
   * (Babel's `trimWhitespace` of the raw JSX text, attributes as `solidAttrs`), its components and `<rt.NoHydration>`
   * holes are boxed in `<!--$-->…<!--/-->` when their element has more than one child (babel-plugin-jsx-dom-expressions
   * `transformChildren`), and a component's children reach it as Babel shapes them (decoded text, `{ t }` elements).
   * Null when any part keeps its JSX (fragments, long texts, components outside `KIT_CHUNK`, a Button with run/set).
   */
  // Kinds are numbers: a string literal in this file joins the recipe class union (recipe-classes.ts) and flips every story's CSS version.
  type Preview =
    | { kind: typeof P.NONE_K }
    | { kind: typeof P.TEXT; value: string } | { kind: typeof P.LIT; value: string } | { kind: typeof P.HOLE_TEXT; value: string }
    | { kind: typeof P.ELEMENT; html: string } | { kind: typeof P.COMPONENT; html: string };
  const NONE: Preview = { kind: P.NONE_K };
  function previewOf(node: JsxNode, path: string, ctx: Ctx): Preview | null {
    const values = ctx.preview!.values;
    if (node.type === 'text') {
      if (node.value === '') return NONE;
      if (node.value.length > 1024) return null;
      return /\r|\n/.test(node.value) ? { kind: P.LIT, value: node.value } : { kind: P.TEXT, value: node.value };
    }
    if (node.type === 'expression') {
      if (!node.value.static) {
        const value = isReactiveExpression(node.value.reactive) ? evaluateReactive(node.value.reactive, values, undefined) : null;
        return typeof value === 'string' || typeof value === 'number' ? { kind: P.LIT, value: String(value) } : NONE;
      }
      const v = node.value.json;
      return typeof v === 'string' || typeof v === 'number' ? { kind: P.HOLE_TEXT, value: String(v) } : NONE;
    }
    if (node.control) {
      if (node.control.kind === 'fragment') return null;
      if (!isReactiveExpression(node.control.test) || node.children.length !== 2) return NONE;
      const yes = Boolean(evaluateReactive(node.control.test, values));
      return node.control.kind === 'and' && !yes ? NONE : previewOf(node.children[yes ? 0 : 1]!, `${path}.${yes ? 0 : 1}`, ctx);
    }
    if (INERT.has(node.tag)) return NONE;
    return previewElement(node, path, ctx);
  }
  /** A native element's children as its server template writes them, or null. */
  function previewChildren(parts: ReadonlyArray<Preview | null>): string | null {
    const shown: Preview[] = [];
    for (const part of parts) {
      if (part === null) return null;
      if (part.kind === P.NONE_K) continue;
      // Adjacent JSX texts are one JSX text, and a whitespace run that is not all spaces is not counted as a child.
      if (part.kind === P.TEXT) {
        const text = part.value;
        if (shown.at(-1)?.kind === P.TEXT || (/^\s*$/.test(text) && !/^ *$/.test(text))) return null;
      }
      shown.push(part);
    }
    const boxed = shown.length > 1;
    return shown.map((part) => {
      if ((part.kind === P.ELEMENT || part.kind === P.COMPONENT)) return part.kind === P.ELEMENT ? part.html : boxed ? `<!--$-->${part.html}<!--/-->` : part.html;
      if (part.kind === P.TEXT) return solidTrimText(jsxLiteral(part.value));
      if (part.kind === P.LIT) return solidText(part.value);
      if (part.kind !== P.HOLE_TEXT) return '';
      return boxed ? `<!--$-->${solidText(part.value)}<!--/-->` : solidText(part.value);
    }).join('');
  }
  /** A component's children as Babel hands them to it: text decoded and trimmed, elements and components as `{ t }`. */
  function previewComponentChildren(parts: ReadonlyArray<Preview | null>): unknown[] | null {
    const out: unknown[] = [];
    for (const part of parts) {
      if (part === null) return null;
      if (part.kind === P.NONE_K) continue;
      if ((part.kind === P.ELEMENT || part.kind === P.COMPONENT)) out.push({ t: part.html });
      else if (part.kind !== P.TEXT) out.push(part.value);
      else if (shownText(part.value)) out.push(solidTextValue(part.value));
    }
    return out;
  }
  const shownText = (value: string): boolean => solidTrimText(jsxLiteral(value)).length > 0;
  function previewElement(node: JsxElement, path: string, ctx: Ctx): Preview | null {
    const preview = ctx.preview!;
    const element = (tag: string, attrs: Attr[], inner: string | null): Preview | null => {
      const attrHtml = solidAttrs(attrs, safeAttr);
      if (attrHtml === null || inner === null) return null;
      return { kind: P.ELEMENT, html: VOID.test(tag) ? `<${tag}${attrHtml}>` : `<${tag}${attrHtml}>${inner}</${tag}>` };
    };
    if (node.tag === 'Markdown') return element('div', markdownAttrs(node, path), markdownContent(markdownSource(node) ?? '').html);
    if (node.tag === 'For') {
      if (isTableParts(node)) return NONE;
      const owner = node.attributes.find((a) => a.name === 'id')?.value;
      const wrapper = rawBuildProps(node.attributes.filter((a) => a.name !== 'each' && a.name !== 'keyBy'), true, node.tag, path, undefined, preview.values);
      const ownerId = owner?.static && typeof owner.json === 'string' ? owner.json : '';
      const props = preview.rewrite({ ...wrapper, id: ownerId || undefined,
        ...(!ctx.svg ? { style: { display: 'contents', ...((wrapper.style && typeof wrapper.style === 'object' ? wrapper.style : {}) as Props) } } : {}) });
      const tag = ctx.svg ? 'g' : 'div';
      return element(tag, elementAttrs(tag, props), '');
    }
    if (node.tag === 'Grid' || node.tag === 'GridItem') {
      const { attrs, inner, kids } = gridParts(node, path, ctx);
      const content = previewChildren(kids.map(([c, p, kidCtx]) => previewOf(c, p, kidCtx)));
      if (inner === null) return element('div', attrs, content);
      const box = element('div', [['class', inner]], content);
      return box && box.kind === P.ELEMENT ? element('div', attrs, box.html) : null;
    }
    if (PREVIEW_EMBEDS[node.tag]) return element('div', elementAttrs('div', { style: PREVIEW_STYLE }), solidText(PREVIEW_EMBEDS[node.tag]!));
    if (node.tag === 'Input' || node.tag === 'Select' || node.tag === 'Switch' || node.tag === 'FileUpload') {
      const previewTag = `Preview${node.tag}`;
      const component = input.kitServer?.static?.[previewTag];
      if (typeof component !== 'function') return null;
      useKit(previewTag, 'static', ctx);
      const p = JSON.parse(JSON.stringify(preview.rewrite(rawBuildProps(node.attributes, true, node.tag, path, undefined, preview.values)) ?? null)) as unknown;
      const html = kitServerHtml(component, { p }, []);
      return html === null ? null : { kind: P.COMPONENT, html };
    }
    if (node.isComponent) {
      if (!KIT_CHUNK.has(node.tag)) return null;
      const meta = node.tag === 'Progress' ? { ...KIT.Progress!, mod: 'static' } : KIT[node.tag];
      const component = meta && input.kitServer?.[meta.mod]?.[node.tag];
      if (!meta || typeof component !== 'function') return null;
      const parts = kitParts(node, path, 'static', ctx, meta);
      if (typeof parts === 'string' || parts.api.run !== undefined || parts.api.set !== undefined) return null;
      useKit(node.tag, 'static', ctx);
      const props: Props = {};
      for (const [k, v] of Object.entries(parts.api)) props[safeAttr(k)] = typeof v === 'string' ? v : JSON.parse(JSON.stringify(v ?? null));
      if (parts.cls) props.class = parts.cls;
      for (const [n, v] of parts.attrs) props[safeAttr(n)] = v === '' && /^(?:disabled|checked|selected|readOnly|hidden|open|multiple|required|inert|autoFocus|reversed)$/i.test(n) ? true : v;
      const children = meta.noChildren ? [] : previewComponentChildren(node.children.map((c, i) => previewOf(c, `${path}.${i}`, ctx)));
      if (children === null) return null;
      const html = kitServerHtml(component, props, children);
      return html === null ? null : { kind: P.COMPONENT, html };
    }
    const lower = node.tag.toLowerCase();
    if (SOLID_SPECIAL_TAGS.has(lower)) return null;
    const tag = safeTag(SVG_TAG_CASE[lower] ?? lower);
    const kids = (inner: Ctx) => previewChildren(node.children.map((c, i) => previewOf(c, `${path}.${i}`, inner)));
    const source = lower === 'img' ? node.attributes.find((a) => a.name.toLowerCase() === 'src') : undefined;
    if (source?.value.static && typeof source.value.json === 'string' && (refName(source.value.json) || parseRowRef(source.value.json) || carriesRef(source.value.json))) {
      const rest = rawBuildProps(node.attributes.filter((a) => a !== source), false, node.tag, path, undefined, preview.values);
      return element('img', elementAttrs('img', { ...rest, 'data-mx-bound': `src:${source.value.json}` }), '');
    }
    const boundTable = ['input', 'select', 'textarea'].includes(lower) ? REF_ATTRS.html[lower] : null;
    const boundAttrs = boundTable ? node.attributes.filter((a) => boundTable[a.name.toLowerCase()] && a.value.static && refName(a.value.json)) : [];
    if (boundAttrs.length) {
      const bind = Object.entries(Object.fromEntries(boundAttrs.map((a) => [a.name.toLowerCase(), refName(a.value.static ? a.value.json : null)])))
        .map(([name, value]) => `${name}:$${value}`).join(' ');
      const props = rawBuildProps(node.attributes.filter((a) => !boundAttrs.includes(a)), false, node.tag, path, undefined, preview.values);
      return element(tag, elementAttrs(tag, { ...props, disabled: true, 'data-mx-bound': bind }), VOID.test(lower) ? '' : kids(ctx));
    }
    let props = rawBuildProps(node.attributes, false, node.tag, path, undefined, preview.values);
    const patch = resolveRefProps(node, props, refData);
    if (patch) props = { ...props, ...patch };
    props = preview.rewrite(props);
    const selectedValue = lower === 'select' ? props.defaultValue ?? props.value : undefined;
    const inner = lower === 'svg' ? { ...ctx, svg: true } : selectedValue !== undefined ? { ...ctx, selectValue: String(selectedValue) } : ctx;
    const attrs = elementAttrs(tag, props);
    if (lower === 'option' && ctx.selectValue !== undefined) {
      const value = props.value ?? node.children.map((child) => child.type === 'text' ? child.value : '').join('');
      const i = attrs.findIndex(([name]) => name === 'selected');
      if (i >= 0) attrs.splice(i, 1);
      if (String(value) === ctx.selectValue) attrs.push(['selected', '']);
    }
    if (VOID.test(lower)) return element(lower, attrs, '');
    if (lower === 'textarea' && (props.defaultValue !== undefined || props.value !== undefined)) return element(tag, attrs, solidText(String(props.defaultValue ?? props.value)));
    return element(tag, attrs, kids(inner));
  }

  function emitFor(node: JsxElement, path: string, mode: Mode, ctx: Ctx): string {
    const each = node.attributes.find((a) => a.name === 'each');
    const name = each && !each.value.static && each.value.reactive?.kind === 'signal' ? each.value.reactive.name : null;
    if (!name) return `<div role="alert">{"For requires each={$table}"}</div>`;
    const keyBy = node.attributes.find((a) => a.name === 'keyBy')?.value;
    const owner = node.attributes.find((a) => a.name === 'id')?.value;
    if (ctx.preview) {
      if (isTableParts(node)) return '';
      const wrapper = rawBuildProps(node.attributes.filter((a) => a.name !== 'each' && a.name !== 'keyBy'), true, node.tag, path, undefined, ctx.preview.values);
      const ownerId = owner?.static && typeof owner.json === 'string' ? owner.json : '';
      const props = ctx.preview.rewrite({ ...wrapper, id: ownerId || undefined,
        ...(!ctx.svg ? { style: { display: 'contents', ...((wrapper.style && typeof wrapper.style === 'object' ? wrapper.style : {}) as Props) } } : {}) });
      const tag = ctx.svg ? 'g' : 'div';
      return `<${tag}${jsxAttrs(elementAttrs(tag, props))}></${tag}>`;
    }
    const wrapper = rawBuildProps(node.attributes.filter((a) => a.name !== 'each' && a.name !== 'keyBy'), true, node.tag, path, undefined, {});
    const ownerId = owner?.static && typeof owner.json === 'string' ? owner.json : '';
    const svg = !!ctx.svg;
    // `display: contents`: the rows are laid out by the For's PARENT (an author's grid or flex sees each row as a
    // child), not boxed by a wrapper that would stack them in one cell. The wrapper still owns the id and the attrs.
    const style = svg ? {} : { style: { display: 'contents', ...((wrapper.style && typeof wrapper.style === 'object' ? wrapper.style : {}) as Props) } };
    const { className, ...rest } = wrapper;
    // The wrapper's style goes to rt.Repeat as `attr:style`: its spread then SETS the attribute (skipped while
    // hydrating), keeping the served `display:contents` byte for byte. A spread `style` would be rewritten
    // through the CSSOM (`min-height: 1px;`) during hydration, which the served page must not do.
    const attrs = elementAttrs(svg ? 'g' : 'div', { ...rest, ...(className ? { className } : {}), ...style, id: ownerId || undefined })
      .map(([n, v]): Attr => [n === 'style' ? 'attr:style' : n, v]);
    const suffix = path.replace(/\./g, '_');
    const row = `row${suffix}`;
    const scope = `scope${suffix}`;
    const body = node.children.map((c, i) => emit(c, `${path}.${i}`, mode, { ...ctx, row, scope })).join('');
    const keyJsx = keyBy?.static ? ` keyBy={${lit(keyBy.json)}}` : '';
    return `<rt.Repeat name={${lit(name)}}${keyJsx} owner={${lit(ownerId)}} ids={${json([...templateIds(node.children)])}}${isTableParts(node) ? ' tableParts={true}' : ''}${svg ? ' svg={true}' : ''}${jsxAttrs(attrs)}>{(${row}, ${scope}) => <>${body}</>}</rt.Repeat>`;
  }

  // The column wrapper the runtime always draws.
  const body = nodes.map((n, i) => emit(n, String(i), 'static', { row: null })).join('');
  const browserBody = nodes.map((n, i) => emit(n, String(i), 'browser', { row: null })).join('');
  // A DECK's chrome: static HTML at compile time, thumbnails
  // included; its behaviour is the framework-free `@mx/deck` chunk.
  const slides = input.chrome !== false ? discoverSlides(nodes) : [];
  const deck = slides.length >= MIN_SLIDES_FOR_RAIL;
  const columnClass = input.template === 'doc' ? 'mx-doc mx-doc--document' : 'mx-doc';
  let root = `<div class="${columnClass}">${body}</div>`;
  if (deck) {
    const allocate = createPreviewPropsAllocator(nodes, '_R_1_');
    const previewValues = declaredValues(input.flow);
    const buttonTags = new Set(['button', 'input', 'select', 'textarea', 'Button', 'TabsTrigger', 'AccordionTrigger', 'CollapsibleTrigger', 'PopoverTrigger', 'DialogTrigger', 'DialogClose', 'Switch', 'Segmented', 'Select', 'DatePicker', 'Input', 'Textarea', 'Slider', 'FileUpload']);
    const hasButton = (node: JsxNode): boolean => isElement(node) && (buttonTags.has(node.tag) || node.children.some(hasButton));
    const rail = slides.map((slide) => {
      // The same Solid skeleton renderer draws a miniature with declared values and rail-local IDs.
      const preview: Ctx['preview'] = { rewrite: allocate([slide.node], slide.path), values: previewValues };
      // Rendered here when every part can be (`previewOf`); the constants its JSX would hoist are never read by the browser module.
      const mark = data.length;
      const shown = input.staticHtml === false ? null : previewOf(slide.node, '0', { row: null, preview });
      data.length = mark;
      const miniature = shown && (shown.kind === P.ELEMENT || shown.kind === P.COMPONENT) ? staticChunkJsx(staticHtml.push(shown.html) - 1) : emit(slide.node, '0', 'static', { row: null, preview });
      // A miniature holding a button sits in the rail row's own button: parsed in place, the inner button would close
      // the row. Served inert in a `<template>` (a parser scope boundary) and put in place by the deck behaviour
      // (lib/islands/deck RAIL_THUMB_ATTR), so the rail ends as the tree the former rail rendered.
      const thumb = hasButton(slide.node) ? `<template ${RAIL_THUMB_ATTR}="">${miniature}</template>` : miniature;
      return `<button type="button" class="mx-rail-row" aria-label={${lit(`Go to slide ${slide.index + 1}: ${slide.title}`)}} aria-current={${lit(String(slide.index === 0))}}><span class="mx-rail-label"><span class="mx-rail-index">{${lit(String(slide.index + 1))}}</span><span class="mx-rail-title">{${lit(slide.title)}}</span></span><span class="mx-rail-thumb" aria-hidden="true"><div style="--mx-vh:800px">${thumb}</div></span></button>`;
    }).join('');
    root = `<div class="mx-deck"><rt.NoHydration><nav class="mx-rail" aria-label="Slides">${rail}</nav></rt.NoHydration>${root}<rt.NoHydration><div class="mx-present" aria-label="Slide controls"><button type="button" aria-label="Previous slide">{"‹"}</button><span class="mx-present-count" aria-label="Slide position">{${lit(`1 / ${slides.length}`)}}</span><button type="button" aria-label="Next slide">{"›"}</button><button type="button" aria-label="Present">{"present"}</button></div></rt.NoHydration></div>`;
  }

  const kitImports = (set: Set<string>): string => {
    const byMod: Record<string, string[]> = {};
    for (const tag of set) (byMod[tag.startsWith('Preview') ? 'static' : tag === 'BoundNative' ? 'controls' : tag === 'BoundImage' ? 'image' : tag === 'rowImageAttrs' ? 'files' : CELL_EXPORTS.has(tag) ? 'cells' : tag === 'Progress' ? 'static' : KIT[tag]!.mod] ??= []).push(tag);
    return Object.entries(byMod).sort(([a], [b]) => a.localeCompare(b)).map(([mod, tags]) => `import { ${tags.sort().map((tag) => tag === 'Skeleton' ? 'Skeleton as StaticSkeleton' : safeProp(tag)).join(', ')} } from ${lit(`@mx/kit/${safeTag(mod)}`)};\n`).join('');
  };
  const dataConsts = data.map((text, i) => `const $d${i} = JSON.parse(${lit(text)});\n`).join('');
  const moduleData: string[] = [];
  const browserRoot = deck ? `<div class="mx-deck"><rt.NoHydration /><div class="${columnClass}">${browserBody}</div><rt.NoHydration /></div>` : `<div class="${columnClass}">${browserBody}</div>`;
  const browserUses = new Set([...browserRoot.matchAll(/\$d(\d+)\b/g)].map((match) => Number(match[1])));
  const browserConsts = data.map((value, i) => {
    if (!browserUses.has(i)) return '';
    if (value.length <= 1024) return `const $d${i} = JSON.parse(${lit(value)});\n`;
    const index = moduleData.push(value) - 1;
    return `const $d${i} = $moduleData[${index}];\n`;
  }).join('');
  const usesRowAttrs = root.includes('$rowAttrs(') || browserRoot.includes('$rowAttrs(');
  const rowImports = `${usesRowAttrs ? "import { rowAttrs as $rowAttrs } from '@mx/kit/basic';\n" : ''}${usesRowClass ? "import { rowClass as $rowClass } from '@mx/row-class';\n" : ''}`;
  const skeleton = `import * as rt from '@mx/rt';\n${rowImports}${kitImports(kitUsed.skeleton)}${dataConsts}export function Document() { return ${root}; }\n`;
  const browserSource = `import * as rt from '@mx/rt';\n${rowImports}${kitImports(kitUsed.islands)}${dataConsts}export function Document() { return ${browserRoot}; }\n`;
  return {
    skeleton,
    islands: skeleton,
    browserIslands: dataConsts ? browserSource.replace(dataConsts, `${moduleData.length ? MODULE_DATA_READ_CODE : ''}${browserConsts}`) : browserSource,
    moduleData,
    islandRefs: nodes.some(needsBrowser) ? [{ renderId: 'd-', path: '0', kit: [...kitUsed.islands].sort(), readsData: !!input.flow && nodes.some(readsDataNode) }] : [],
    kit: { skeleton: [...kitUsed.skeleton].sort(), islands: [...kitUsed.islands].sort() },
    reactStatic: [],
    unported: [...unported].sort(),
    partial: [...partial].sort(),
    behaviors: deck ? [DECK_BEHAVIOR] : [],
    staticTexts,
    staticHtml,
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
  const generated = generate({ ...input, glyphCatalogUrl: build.manifest['@mx/glyphs'], kitServer: await loadKitServer() });
  const unknown = generated.behaviors.filter((b) => !build.manifest[b]);
  if (unknown.length) throw new Error(`compile: the island build carries no ${unknown.join(', ')}`);
  // Classified with the anonymous reader's admission the caller decided (snapshots.server
  // anonymousAccessFacts), so this is the plan snapshots key on; without it no dataset is admitted and
  // every query that reads one is `viewer` — never a private answer in a guest snapshot.
  const plan = input.flow ? planOf(input.flow, input.access ?? { datasets: {} }) : null;
  // SQL scope alone does not see a reader reference used by authored JSX, such as
  // `{$_me.id ? <form>…</form> : <SignIn>…</SignIn>}`. Preserve the parser's
  // dependency report with this version so serving can retain its viewer door.
  // FileUpload reads viewer() for signed-out availability even without an authored $_me expression.
  const readsViewerMarkup = generated.kit.islands.includes('FileUpload') || collectRefNameUses(input.nodes).some((use) => use.name === '_me.id' || use.name.startsWith('_me.'));
  const links = input.nodes.length ? linkHintsOf(input.nodes, { origins: deploymentOrigins() }) : EMPTY_LINK_HINTS;
  const outlinePlan = input.template === 'plan';
  const outlineDoc = input.template === 'doc';
  const outline = !input.chrome ? [] : outlineDoc ? discoverOutline(input.nodes, true)
    : (input.template === 'editorial' || outlinePlan) && hasOutline(input.nodes) ? discoverOutline(input.nodes) : [];
  const base = {
    build: build.id, ...(build.ssr ? { ssrHalf: build.ssr.url } : {}), handoverContract: MIN_HANDOVER_CONTRACT, islands: generated.islandRefs, behaviors: generated.behaviors, plan, readsViewerMarkup, links, outline, outlinePlan, outlineDoc,
    kit: generated.kit, reactStatic: generated.reactStatic, unported: generated.unported, partial: generated.partial,
    // Data for the page's JSON island, never module code (contract CompiledPage.authorScript).
    authorScript: input.authorScript || null,
  };
  if (generated.unported.length) return { ...base, html: '', module: null, ssr: null };
  // A version with an author script boots even with no island: its store and its author host start there.
  const built = await buildDocumentModules(generated, { build, flow: input.flow, values: declaredValues(input.flow), boot: !!base.authorScript });
  return { ...base, html: built.html, module: built.module, ssr: built.ssr, templateBrBytes: built.templateBrBytes };
}
