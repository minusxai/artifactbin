/** @jsxImportSource solid-js */
/** Attach prose editing to the compiler's `data-mx-ast` DOM without interpreting the document again. */
import { createSignal, type Setter } from 'solid-js';
import { render } from 'solid-js/web';
import { serializeJsx, type JsxNode } from '@/lib/jsx';
import { editorDocument, isProseTree, sourceNodes } from '@/lib/editor-engine/model';
import type { EditorSelectionChange } from '@/lib/editor-engine/bookmark';
import type { EditorView } from 'prosemirror-view';
import { isEditableTextHost } from '@/lib/story-ui/host-classify';
import { gridCols, gridItemRect, gridRowHeight } from '@/lib/story-ui/grid-layout';
import { STORY_GRID_EDIT_CSS } from '@/lib/story-ui/grid-css';
import type { StoryLayoutRect } from '@/lib/story-runtime/contract';
import { FlowEditor } from './FlowEditor';
import { flushFlowView, repathFlowView } from '@/lib/editor-engine/flow-view';
import { GridEdit, type GridTile } from './GridEdit';
import { discoverSlides } from '@/lib/story-runtime/slides';
import { AST_PATH_ATTR as AST_PATH } from '@/lib/story-ui/ast-path';
import { isScriptComponent, MOUNT_ATTR } from '@/lib/story-runtime/script-mount';

export interface CompiledEditCallbacks {
  onFlow(path: string, expected: string, replacement: string, group?: string, selection?: EditorSelectionChange): void;
  onLayout?(rects: StoryLayoutRect[]): void;
  onSlideTitle?(path: string, title: string): void;
  /** "Edit script" on a script component's mount badge (`component` is the mount's name). */
  onOpenScript?(component: string): void;
  onError?(message: string): void;
  onBusy?(busy: boolean): void;
  onView?(view: EditorView | null): void;
  onHostFocus?(path: string, element: HTMLElement): void;
  onHostInput?(path: string): void;
  onHostBlur?(path: string): void;
}

export interface CompiledEditMount {
  /** Hand pending typing to the owner before it flushes or saves source. */
  flush(): void;
  dispose(): void;
  /**
   * Adopt a compiled draft WITHOUT touching the editor when it changes nothing but the text the prose
   * editors already show: the live ProseMirror views (state, caret, history, DOM) stay, only their
   * nodes and paths move to the draft's. `before` and `after` are two parses of the authored source (the
   * tree on screen and the draft's), `next` is the draft's tree as the editor mounts it, `draft` its
   * compiled story root (null: not compiled — the editors' own blocks stand in for it on leaving).
   * False, and nothing changed, when anything else differs: the caller draws it.
   */
  reconcile(before: JsxNode[], after: JsxNode[], next: JsxNode[], draft: HTMLElement | null, options?: ReconcileOptions): boolean;
  /**
   * Before a compiled draft is drawn: hold every editor whose region the draft compiles to exactly the blocks it
   * stands in for (same prose, same compiled HTML, wherever its path moved). In `draft` (off the page) those blocks
   * become a stand-in, `[data-mx-edit-region="<new path>"]`, where the morph places the live editor (the result's
   * `stands`); `dispose` then leaves held editors running, and the next mount, given them, adopts them under their
   * new paths instead of building them again. A redraw rebuilds only the regions it changed.
   */
  hold(next: JsxNode[], draft: HTMLElement): HeldEditors;
  /**
   * Decide `hold` for this draft ahead, a few regions while `more()` (one at least), reading only: true once decided.
   * The draw then holds at once when the editors still stand as they were decided over (it decides again otherwise).
   */
  prepareHold(next: JsxNode[], draft: HTMLElement, more: () => boolean): boolean;
}

/** Editors held across a redraw (`CompiledEditMount.hold`), by their region's path in the draft. */
export interface HeldEditors {
  /** The live editor roots the morph places at the draft's stand-ins, by the stand-in's path. */
  readonly stands: ReadonlyMap<string, HTMLElement>;
  /** For the next mount: the held editor at `path`, taken (once). */
  take(path: string): RegionEditor | undefined;
  /** Tear down every editor no mount took, its compiled blocks back in its place. */
  dispose(): void;
  /** The draw did not happen: every editor goes back to running as it was, and the draft gets its blocks back. */
  release(): void;
}

/** One mounted prose editor. */
interface RegionEditor {
  mount: HTMLElement;
  view(): EditorView | null;
  /** The source of the blocks it shows, as last drawn or handed over. */
  shown(): JsxNode[];
  /** The compiled blocks it stands in for, put back when it leaves. */
  restore: HTMLElement[];
  /** `compiledKey(restore)`, kept while `restore` stays: a redraw compares every kept editor's blocks with the draft's. */
  restoreKey?: string;
  handedOver(text: string): boolean;
  adopt(region: JsxNode[], elements: () => HTMLElement[]): void;
  /**
   * The same editor at a new path (blocks added or removed ahead of it); its prose is the region's already. Its edits
   * carry the new path at once; the returned steps (none: the path did not move) bring its AST-path decorations up
   * to date — every cell of a table, a few rows a step — for the caller to run in order, in idle slices.
   */
  repath(path: string): Array<() => void>;
  dispose(): void;
}

export interface ReconcileOptions {
  /**
   * The draft is the page's own source NOW (an undo, a remote document, a command): an editor whose prose
   * differs takes the draft's, in place, instead of the page being redrawn. Never while an editor holds typing.
   */
  sync?: boolean;
  /** The sources `before` and `after` were parsed from: an unchanged region is recognised by its text alone. */
  beforeSource?: string;
  afterSource?: string;
}

interface ProseRegion { path: string; parentPath: string; start: number; nodes: JsxNode[] }

const isBlock = (node: JsxNode): boolean => node.type === 'element'
  && !['thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'span', 'strong', 'b', 'em', 'i', 'a', 'code', 'br', 'small', 'sup', 'sub', 's', 'del', 'u'].includes(node.tag)
  && isProseTree(node);

const isTable = (node: JsxNode | undefined): boolean => node?.type === 'element' && node.tag === 'table';
/**
 * Where the prose run starting at `start` ends. A table is a region of its own: typing in a paragraph never
 * re-serializes the tables around it (a data report holds dozens), and a cell edit serializes only its table.
 */
function regionEnd(siblings: JsxNode[], start: number): number {
  if (isTable(siblings[start])) return start + 1;
  let index = start + 1;
  while (index < siblings.length && ((isBlock(siblings[index]!) && !isTable(siblings[index])) || (siblings[index]!.type === 'text' && !(siblings[index] as { value: string }).value.trim()))) index++;
  return index;
}

/** The measured height of a region's compiled blocks, on its mount: the edit-mode CSS's off-screen placeholder size. */
const REGION_HEIGHT_VAR = '--mx-region-h';
/** How many recent hand-overs an editor remembers: drafts in flight are one or two behind it. */
const HANDED_KEPT = 8;
/**
 * How long an off-screen mount slice may build editors (one region at least). The page's own style pass for what a
 * slice inserted follows at the next frame; on a table-heavy page that pass, not the editors, is most of the time.
 */
const SLICE_MS = 16;
/**
 * One idle slice of queued work (`next` hands the next item, undefined when none is left). An item is started only
 * when the last one's cost still fits in what is left of `budget`, so a slice ends under it instead of one item past
 * it (a table's path redraw is most of a slice by itself); the first item always runs. Returns the cost to expect next.
 */
export function runSlice(next: () => (() => void) | undefined, now: () => number, budget: number, expected: number): number {
  const until = now() + budget;
  for (let first = true; ; first = false) {
    const started = now();
    if (!first && started + expected > until) return expected;
    const item = next();
    if (!item) return expected;
    item();
    expected = now() - started;
  }
}
const isBreak = (node: JsxNode | undefined): boolean => node?.type === 'text' && !node.value.trim();
/**
 * The editor's blocks, laid out with the line breaks the region had between and after its blocks. Breaks are child
 * nodes, and every path after the region counts them: written compactly, the first pause would move every later
 * block's path, so the draft no longer matched the page and went to the compiler for a full redraw. A block the
 * editor added takes the region's usual break.
 */
export function withRegionBreaks(previous: JsxNode[], replacement: JsxNode[]): JsxNode[] {
  if (!previous.some(isBreak)) return replacement;
  // A region starts at a block; the breaks after block i are gaps[i], the last block's are the region's trailing ones.
  const gaps: JsxNode[][] = [];
  for (const node of previous) {
    if (!isBreak(node)) gaps.push([]);
    else gaps.at(-1)?.push(node);
  }
  const trailing = gaps.pop() ?? [];
  const usual = gaps.find((gap) => gap.length) ?? trailing;
  const out: JsxNode[] = [];
  replacement.forEach((node, index) => {
    out.push(node);
    if (index < replacement.length - 1) out.push(...(gaps[index] ?? usual));
  });
  return [...out, ...trailing];
}

/**
 * Two trees with the same content, source offsets aside (they move with every edit above): what an editor shows
 * and what a draft draws there. Stops at the first difference; a node shared by both is equal without a walk.
 */
export function sameNodes(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!sameNodes(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  let count = 0;
  for (const key in left) {
    if (key === 'start' || key === 'end' || left[key] === undefined) continue;
    count++;
    if (!sameNodes(left[key], right[key])) return false;
  }
  for (const key in right) if (key !== 'start' && key !== 'end' && right[key] !== undefined) count--;
  return count === 0;
}

/** The prose runs the mounter gives one editor each, by the same walk as `visit` (without the DOM). */
function proseRegions(nodes: JsxNode[]): ProseRegion[] {
  const regions: ProseRegion[] = [];
  const walk = (siblings: JsxNode[], parentPath: string) => {
    for (let index = 0; index < siblings.length;) {
      const node = siblings[index]!;
      if (!isBlock(node)) {
        if (node.type === 'element' && !isScriptComponent(node)) walk(node.children, [parentPath, String(index)].filter(Boolean).join('.'));
        index++;
        continue;
      }
      const start = index++;
      index = regionEnd(siblings, start);
      regions.push({ path: [parentPath, String(start)].filter(Boolean).join('.'), parentPath, start, nodes: siblings.slice(start, index) });
    }
  };
  walk(nodes, '');
  return regions;
}

/** Everything OUTSIDE the prose regions, by path: a draft that changes none of it changed only prose. */
function outsideProse(nodes: JsxNode[], regions: ProseRegion[]): Map<string, string> {
  const spans = new Map<string, Array<[number, number]>>();
  for (const region of regions) {
    const list = spans.get(region.parentPath) ?? [];
    list.push([region.start, region.start + region.nodes.length]);
    spans.set(region.parentPath, list);
  }
  const found = new Map<string, string>();
  const walk = (siblings: JsxNode[], parentPath: string) => siblings.forEach((node, index) => {
    if (spans.get(parentPath)?.some(([from, to]) => index >= from && index < to)) return;
    const path = [parentPath, String(index)].filter(Boolean).join('.');
    // Serialized, so source offsets (which every edit above shifts) never count.
    if (node.type === 'element') {
      found.set(path, serializeJsx([{ ...node, children: [] }]));
      walk(node.children, path);
    } else found.set(path, serializeJsx([node]));
  });
  walk(nodes, '');
  return found;
}

/** A tree with its text left out: what text-only changes leave alone. */
/** Blocks and attributes without their text: key order is not shape (a served tree spells values {json, static}, the page's parse {static, json}). */
const shapeKey = (nodes: JsxNode[]): string => JSON.stringify(nodes, (key, value) => {
  if ((key === 'value' && typeof value === 'string') || key === 'start' || key === 'end') return undefined;
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, value[name]])) : value;
});

/** Prose as the editor holds it: parsing collapses source whitespace, so compare engine to engine. */
const proseKey = (nodes: JsxNode[]): string => serializeJsx(sourceNodes(editorDocument(nodes)));

const sameMaps = (a: Map<string, string>, b: Map<string, string>): boolean =>
  a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);

/** Item placement a lone block hands to the editor root that stands in for it in a flex/grid parent. */
const PLACEMENT = ['grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end', 'flex-grow', 'flex-shrink', 'flex-basis', 'align-self', 'justify-self', 'order'] as const;

/** The attribute on a region's editor root, and on a held editor's stand-in in a draft. */
export const EDIT_REGION_ATTR = 'data-mx-edit-region';
/**
 * Inside a component island (not the whole-document tree): its DOM is the island's, which the morph keeps or replaces
 * whole and hydration renders, so an editor there is never held — its stand-in would be all the island showed.
 */
const inIsland = (el: Element): boolean => !!el.parentElement?.closest('[data-hk]:not([data-hk^="d-"])');
/** Compiled blocks compared across a redraw: their AST paths are positional (a block added above moves them). */
const compiledKey = (blocks: readonly Element[]): string => blocks.map((block) => block.outerHTML.replace(/ data-mx-ast="[^"]*"/g, '')).join('');
const restoreKeyOf = (editor: RegionEditor): string => (editor.restoreKey ??= compiledKey(editor.restore));

/** A script mount's badge: what renders the mount, and the way to its code. Editor chrome (`data-mx-node-chrome`). */
function ScriptMountBadge(props: { name: string; onEdit: () => void }) {
  const label = `${props.name} · rendered by the script`;
  // Native listeners, stopped here: selection listens on the document in the capture phase for clicks, but a press
  // on the badge must never select the block around it.
  const stop = (event: Event) => event.stopPropagation();
  return <div role="group" aria-label={label} data-mx-node-chrome="" contenteditable="false"
    style={{ display: 'flex', 'align-items': 'center', gap: '8px', width: 'fit-content', margin: '0 0 6px', padding: '2px 4px 2px 8px',
      font: '500 12px/1.5 system-ui, sans-serif', border: '1px dashed currentColor', 'border-radius': '6px', opacity: '0.8' }}>
    <span>{label}</span>
    <button type="button" on:pointerdown={stop} on:mousedown={stop}
      on:click={(event) => { event.preventDefault(); props.onEdit(); }}
      style={{ font: 'inherit', padding: '0 6px', border: '1px solid currentColor', 'border-radius': '4px', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
      Edit script
    </button>
  </div>;
}

/**
 * Edit mode over a script component's mount: the script is stopped (lib/islands/boot), so the mount shows its
 * server-rendered fallback (lib/islands/page-runtime puts it back). The fallback is not the author's to type into —
 * the component replaces it when the script runs — so it is made inert, and a badge says what renders it with an
 * "Edit script" control. Returns the undo: the mount exactly as served, before the script mounts over it again.
 */
function badgeScriptMount(mount: HTMLElement, callbacks: CompiledEditCallbacks): () => void {
  const name = mount.getAttribute(MOUNT_ATTR) ?? '';
  const madeInert: Element[] = [];
  for (const child of mount.children) if (!child.hasAttribute('inert')) { child.setAttribute('inert', ''); madeInert.push(child); }
  const host = mount.ownerDocument.createElement('div');
  host.style.display = 'contents';
  const dispose = render(() => <ScriptMountBadge name={name} onEdit={() => callbacks.onOpenScript?.(name)} />, host);
  // Solid renders into the host; the host stays out of the morph's way (removed before any redraw).
  mount.prepend(host);
  return () => {
    dispose();
    host.remove();
    for (const child of madeInert) child.removeAttribute('inert');
  };
}

/** One region replaces only its authored prose siblings; adjacent compiled islands keep their DOM identity. */
export function mountCompiledEditRegions(root: HTMLElement, nodes: JsxNode[], callbacks: CompiledEditCallbacks, held?: HeldEditors): CompiledEditMount {
  const cleanups: Array<() => void> = [];
  /** Every mounted prose editor, by its region's path: what `reconcile` keeps alive. */
  const mounted = new Map<string, RegionEditor>();
  /** Editors `hold` handed to the next mount: `dispose` leaves them running. */
  const holding = new Set<RegionEditor>();
  // GridEdit's grip/resize affordances (STORY_GRID_EDIT_CSS's [data-mx-grid-tile]/.mx-grid-resize
  // rules) are structural, not authored content — same reasoning as the
  // `<style data-mx-grid-css>`, injected inside the story surface rather than the app's <head>. Only with a Grid
  // to edit: a stylesheet added and removed at every redraw re-styled the whole page twice (a forced pass of most
  // of 100 ms on a table-heavy document at slow CPUs).
  const gridStyle = () => {
    if (root.querySelector('style[data-mx-grid-css]')) return;
    const style = root.ownerDocument.createElement('style');
    style.dataset.mxGridCss = '';
    style.textContent = STORY_GRID_EDIT_CSS;
    root.prepend(style);
    cleanups.push(() => style.remove());
  };
  const railRows = root.querySelectorAll<HTMLElement>('.mx-rail .mx-rail-row');
  discoverSlides(nodes).forEach((slide, index) => {
    const row = railRows[index];
    const label = row?.querySelector<HTMLElement>('.mx-rail-label');
    const title = label?.querySelector<HTMLElement>('.mx-rail-title');
    if (!label || !title) return;
    const control = root.ownerDocument.createElement('span');
    control.className = 'mx-rail-rename';
    control.setAttribute('role', 'button');
    control.tabIndex = 0;
    control.setAttribute('aria-label', `Edit slide ${index + 1} title`);
    control.textContent = '✎';
    let activeInput: HTMLInputElement | null = null;
    const open = (event: Event) => {
      event.stopPropagation();
      if (activeInput) return;
      const input = root.ownerDocument.createElement('input');
      activeInput = input;
      input.className = 'mx-rail-title';
      input.setAttribute('aria-label', `Slide ${index + 1} title`);
      input.value = title.textContent ?? '';
      title.replaceWith(input);
      control.hidden = true;
      let done = false;
      const finish = (save: boolean) => {
        if (done) return;
        done = true;
        if (save) callbacks.onSlideTitle?.(slide.path, input.value);
        title.textContent = save ? input.value : title.textContent;
        input.replaceWith(title);
        activeInput = null;
        control.hidden = false;
      };
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('blur', () => finish(true));
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
      });
      input.focus();
    };
    const key = (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(event); } };
    control.addEventListener('click', open);
    control.addEventListener('keydown', key);
    label.append(control);
    cleanups.push(() => { activeInput?.replaceWith(title); control.remove(); });
  });
  for (const mount of root.querySelectorAll<HTMLElement>(`[${MOUNT_ATTR}]`)) cleanups.push(badgeScriptMount(mount, callbacks));
  const at = (path: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-mx-ast="${CSS.escape(path)}"]`);
  const staticProp = (node: JsxNode, name: string): unknown => {
    const value = node.type === 'element' ? node.attributes.find((attr) => attr.name === name)?.value : undefined;
    return value?.static ? value.json : undefined;
  };
  const mountGrid = (node: JsxNode, path: string) => {
    if (node.type !== 'element' || !node.isComponent || node.tag !== 'Grid' || staticProp(node, 'mode') === 'flow') return;
    const grid = at(path);
    if (!grid) return;
    const cols = gridCols(staticProp(node, 'cols'));
    const tiles: GridTile[] = node.children.flatMap((child, index) => {
      if (child.type !== 'element' || child.tag !== 'GridItem') return [];
      const itemPath = `${path}.${index}`;
      if (!at(itemPath)) return [];
      return [{ key: String(staticProp(child, 'id') ?? itemPath), path: itemPath,
        rect: gridItemRect({ x: staticProp(child, 'x'), y: staticProp(child, 'y'), w: staticProp(child, 'w'), h: staticProp(child, 'h') }, cols),
        children: () => <span /> }];
    });
    if (!tiles.length) return;
    gridStyle();
    const overlay = root.ownerDocument.createElement('div');
    overlay.dataset.mxGridEdit = path;
    overlay.style.cssText = 'position:absolute;inset:0;z-index:2;pointer-events:none';
    const oldPosition = grid.style.position;
    grid.style.position = 'relative';
    grid.append(overlay);
    const disposeSolid = render(() => <GridEdit cols={cols} rowHeight={gridRowHeight(staticProp(node, 'rowHeight'))}
      tiles={tiles} onLayout={(rects) => callbacks.onLayout?.(rects)} renderFlow={() => <span />} />, overlay);
    for (const grip of overlay.querySelectorAll<HTMLElement>('.mx-grid-grip,.mx-grid-resize')) grip.style.pointerEvents = 'auto';
    // The overlay tile itself is `pointer-events:none` (only its grip/resize are `auto`), so it can
    // never match `:hover` — the REAL compiled tile underneath it is what the pointer actually lands
    // on. Mirror its hover onto the overlay tile's class so CSS can reveal that tile's grip from it,
    // matching react-grid-layout's own hover-anywhere-on-the-tile affordance.
    for (const tile of tiles) {
      const realTile = at(tile.path);
      const overlayTile = overlay.querySelector<HTMLElement>(`[data-mx-grid-tile="${CSS.escape(tile.key)}"]`);
      if (!realTile || !overlayTile) continue;
      const enter = () => overlayTile.classList.add('mx-grid-hover');
      const leave = () => overlayTile.classList.remove('mx-grid-hover');
      realTile.addEventListener('pointerenter', enter);
      realTile.addEventListener('pointerleave', leave);
      cleanups.push(() => { realTile.removeEventListener('pointerenter', enter); realTile.removeEventListener('pointerleave', leave); });
    }
    cleanups.push(() => { disposeSolid(); overlay.remove(); grid.style.position = oldPosition; });
  };
  /** A prose region found by the read pass: everything its mount needs, measured before any region is mounted. */
  interface RegionMount { path: string; region: JsxNode[]; elements: HTMLElement[]; parent: HTMLElement; layout: 'grid' | 'flex' | null; placement: string[] | null; visible: boolean; height: number }
  const view = root.ownerDocument.defaultView ?? window;
  const regions: RegionMount[] = [];
  /** Held editors this mount takes over, with their region's path and nodes here. */
  const adopted: Array<[string, JsxNode[], RegionEditor]> = [];
  const hosts: Array<() => void> = [];
  const displays = new Map<HTMLElement, string>();
  const viewportHeight = view.innerHeight;
  /**
   * THE READ PASS. Every computed style and position a mount needs is read here, over the compiled DOM as it is,
   * before anything is written. Interleaved (read a region's layout, mount it, read the next one's), each read
   * after a mount recomputed the styles of the whole document: on a table-heavy page that was most of a second per
   * region at slow CPUs, and a redraw remounts every region.
   */
  const visit = (siblings: JsxNode[], parentPath: string) => {
    for (let index = 0; index < siblings.length;) {
      const node = siblings[index]!;
      const path = [parentPath, String(index)].filter(Boolean).join('.');
      // A script component's children are its fallback (the same walk as `proseRegions`): never edited inline.
      if (isScriptComponent(node)) { index++; continue; }
      if (!isBlock(node)) {
        hosts.push(() => mountGrid(node, path));
        if (node.type === 'element' && isEditableTextHost(node)) {
          const host = at(path);
          if (host) hosts.push(() => {
            host.contentEditable = 'true';
            const focus = (event: FocusEvent) => { if (event.target === host) callbacks.onHostFocus?.(path, host); };
            const input = (event: Event) => { if (event.target === host) callbacks.onHostInput?.(path); };
            const blur = (event: FocusEvent) => { if (event.target === host) callbacks.onHostBlur?.(path); };
            host.addEventListener('focus', focus);
            host.addEventListener('input', input);
            host.addEventListener('blur', blur);
            cleanups.push(() => {
              host.removeEventListener('focus', focus);
              host.removeEventListener('input', input);
              host.removeEventListener('blur', blur);
              host.removeAttribute('contenteditable');
            });
          });
        }
        if (node.type === 'element') visit(node.children, path);
        index++;
        continue;
      }
      const start = index++;
      index = regionEnd(siblings, start);
      const region = siblings.slice(start, index);
      const kept = held?.take(path);
      if (kept) {
        if (kept.mount.isConnected && root.contains(kept.mount)) { adopted.push([path, region, kept]); continue; }
        kept.dispose();
      }
      const elements = Array.from({ length: index - start }, (_, offset) => at([parentPath, String(start + offset)].filter(Boolean).join('.')))
        .filter((el): el is HTMLElement => !!el);
      if (!elements.length || !elements[0]!.parentElement || !elements.every((el) => el.parentElement === elements[0]!.parentElement)) continue;
      const parent = elements[0]!.parentElement;
      let display = displays.get(parent);
      if (display === undefined) { display = view.getComputedStyle(parent).display; displays.set(parent, display); }
      const layout = display.includes('grid') ? 'grid' : display.includes('flex') ? 'flex' : null;
      // One block among other flex/grid items: the editor root becomes that item, so it takes the
      // block's own placement (col-span, flex grow, self-alignment) — read before the block leaves.
      let placement: string[] | null = null;
      if (layout && elements.length === 1) { const own = view.getComputedStyle(elements[0]!); placement = PLACEMENT.map((name) => own.getPropertyValue(name)); }
      const first = elements[0]!.getBoundingClientRect(), last = elements.at(-1)!.getBoundingClientRect();
      regions.push({ path, region, elements, parent, layout, placement, visible: last.bottom >= 0 && first.top <= viewportHeight, height: Math.max(0, Math.round(last.bottom - first.top)) });
    }
  };
  /** THE WRITE PASS for one region: its blocks leave, one editor stands in for them. */
  const mountRegion = ({ path: initialPath, region, elements, parent, layout, placement, height }: RegionMount) => {
    if (!elements.every((el) => el.isConnected && el.parentElement === parent)) return;
    let path = initialPath;
    const [currentPath, setCurrentPath] = createSignal(path);
    const mount = root.ownerDocument.createElement('div');
    mount.dataset.mxEditRegion = path;
    mount.style.display = 'contents';
    // The height its blocks had as read: what the editor holds off screen (edit-mode CSS `content-visibility`)
    // until it has rendered once, so a region mounted below the fold moves nothing.
    if (height) mount.style.setProperty(REGION_HEIGHT_VAR, `${height}px`);
    if (placement) PLACEMENT.forEach((name, i) => mount.style.setProperty(`--mx-place-${name}`, placement[i]!));
    let previous = region;
    /** What this editor handed over at its recent pauses: a draft of one of them is this editor's own, passed. */
    const handed: string[] = [];
    let liveView: EditorView | null = null;
    const [current, setCurrent] = createSignal(region) as [() => JsxNode[], Setter<JsxNode[]>];
    const disposeSolid = render(() => <FlowEditor nodes={current()} path={currentPath()}
      onError={callbacks.onError} onBusy={callbacks.onBusy}
      onView={(view) => { if (view) liveView = view; callbacks.onView?.(view); }}
      onChange={(blocks, group, selection) => {
        const replacement = withRegionBreaks(previous, blocks);
        const written = serializeJsx(replacement);
        callbacks.onFlow(path, serializeJsx(previous), written, group, selection);
        previous = replacement;
        handed.push(written.trim());
        if (handed.length > HANDED_KEPT) handed.shift();
      }} />, mount);
    // The editor is built OFF the document and only then takes its blocks' place. ProseMirror writes its root's
    // `contenteditable`, and the browser answers that write by bringing the whole page's styles up to date at once
    // when anything is pending: built in place, every region paid a full style pass of the page (most of a second on
    // a table-heavy document at slow CPUs). Built here, a slice of regions shares one, at the next frame.
    parent.insertBefore(mount, elements[0]!);
    for (const element of elements) element.remove();
    const editor: RegionEditor = {
      mount,
      restore: elements,
      view: () => liveView,
      shown: () => previous,
      handedOver: (text) => handed.includes(text.trim()),
      adopt(next, compiled) {
        previous = next;
        setCurrent(() => next);
        const blocks = compiled();
        if (blocks.length) { editor.restore = blocks; editor.restoreKey = undefined; }
      },
      repath(nextPath) {
        // Held for showing exactly this prose: its nodes stand as they are (the same source), only its path moves —
        // and with it the AST-path decorations, redrawn without rebuilding or re-comparing the prose.
        if (nextPath === path) return [];
        path = nextPath;
        mount.dataset.mxEditRegion = nextPath;
        const steps = liveView ? repathFlowView(liveView, nextPath) : [];
        setCurrentPath(path);
        return steps;
      },
      dispose() {
        if (mount.isConnected && mount.parentNode) {
          // The compiled blocks of the last draft adopted, so leaving shows what was typed.
          for (const element of editor.restore) mount.parentNode.insertBefore(element, mount);
          mount.remove();
        }
        // Torn down off the page, as it was built: removing an editable root in place brought the page's styles up to
        // date at every region.
        disposeSolid();
      },
    };
    mounted.set(path, editor);
    // The editor root replaces the region's blocks as ONE child of their parent; under a flex or
    // grid parent it adopts that layout (edit-mode CSS) so the blocks lay out as they read.
    // The whole content of a flex/grid parent: the root fills it and adopts its layout. Beside
    // other items it stays one item, placed as its single block was. Set on the wrapper, not
    // the editor root: ProseMirror owns its root's attributes.
    if (layout) mount.setAttribute('data-mx-parent-layout', Array.from(parent.children).every((child) => child === mount) ? layout : 'item');
  };
  visit(nodes, '');
  for (const host of hosts) host();
  // Held editors stay as they are: only their path moves to this draft's (their edits carry it at once). The
  // decorations carrying it are redrawn in idle slices, a few table rows a step, ahead of the off-screen mounts: in
  // the draw's own task, one table's redraw was a 50 ms task at slow CPUs, and every kept table on screen added one.
  const redraws: Array<() => void> = [];
  for (const [path, , editor] of adopted) {
    redraws.push(...editor.repath(path));
    mounted.set(path, editor);
    const live = editor.view();
    if (live) callbacks.onView?.(live);
  }
  held?.dispose();
  cleanups.push(() => {
    for (const editor of mounted.values()) if (!holding.has(editor)) editor.dispose();
    mounted.clear();
  });
  /**
   * Regions on screen are editable when this returns. The rest (a long document's off-screen tables) mount in
   * idle slices of about SLICE_MS between frames and input, so a redraw is never one task that freezes typing; until
   * then each shows its compiled blocks, exactly as it reads.
   */
  for (const region of regions) if (region.visible) mountRegion(region);
  let pending = regions.filter((region) => !region.visible);
  let slice: number | null = null;
  const idle = view as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number; cancelIdleCallback?: (handle: number) => void };
  const schedule = () => { slice = idle.requestIdleCallback ? idle.requestIdleCallback(run, { timeout: 100 }) : view.setTimeout(run, 0); };
  let expected = 0;
  const nextItem = (): (() => void) | undefined => {
    if (redraws.length) return redraws.shift()!;
    const region = pending.shift();
    return region ? () => mountRegion(region) : undefined;
  };
  const run = () => {
    slice = null;
    expected = runSlice(nextItem, () => view.performance.now(), SLICE_MS, expected);
    if (redraws.length || pending.length) schedule();
  };
  if (redraws.length || pending.length) schedule();
  cleanups.unshift(() => {
    pending = [];
    redraws.length = 0;
    if (slice !== null) { if (idle.cancelIdleCallback) idle.cancelIdleCallback(slice); else view.clearTimeout(slice); }
  });
  /** The editors a hold may keep, in page order: a region is matched with the editor that showed it, not an identical one elsewhere. */
  const holdable = () => [...mounted.values()]
    .filter((editor) => editor.mount.isConnected && !editor.mount.hasAttribute('data-mx-parent-layout') && !holding.has(editor))
    .sort((a, b) => (a.mount.compareDocumentPosition(b.mount) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  /** A hold decided over a draft, region by region, reading only (the stand-ins are made by `hold`). */
  interface HoldPlan {
    next: JsxNode[];
    draft: HTMLElement;
    /** The editors as they stood when it was decided: what each showed, and which had the caret. */
    live: RegionEditor[];
    shown: JsxNode[][];
    focused: RegionEditor | undefined;
    matches: Array<{ region: ProseRegion; editor: RegionEditor; blocks: HTMLElement[]; key: string }>;
    /** Decide more regions while `more()` (one at least); true once every region is decided. */
    step(more: () => boolean): boolean;
  }
  let plan: HoldPlan | null = null;
  const focusedOf = (live: RegionEditor[]) => live.find((editor) => editor.view()?.hasFocus());
  /** Still what `hold` would decide now: the same editors, showing the same prose, the caret in the same one. */
  const planCurrent = (decided: HoldPlan): boolean => {
    const live = holdable();
    return live.length === decided.live.length && live.every((editor, i) => editor === decided.live[i] && editor.shown() === decided.shown[i])
      && focusedOf(live) === decided.focused;
  };
  const planHold = (next: JsxNode[], draft: HTMLElement): HoldPlan => {
    const live = holdable();
    const regions = proseRegions(next);
    // The draft's region blocks by path, in one pass over the draft (a query per block scanned it once each).
    const wanted = new Set(regions.flatMap((region) => region.nodes.map((_, offset) => [region.parentPath, String(region.start + offset)].filter(Boolean).join('.'))));
    const byPath = new Map<string, HTMLElement>();
    // A region block holds no other region's block (its prose is the region's), so the walk never enters one: a
    // table's thousands of cells are not visited.
    const find = (parent: Element) => {
      for (let el = parent.firstElementChild; el; el = el.nextElementSibling) {
        const path = el.getAttribute(AST_PATH);
        if (path !== null && wanted.has(path)) { if (!byPath.has(path)) byPath.set(path, el as HTMLElement); continue; }
        find(el);
      }
    };
    find(draft);
    const decided: HoldPlan = { next, draft, live, shown: live.map((editor) => editor.shown()), focused: focusedOf(live), matches: [], step };
    let index = 0, from = 0;
    function step(more: () => boolean): boolean {
      while (index < regions.length) {
        const region = regions[index++]!;
        let found = -1;
        // Compared as trees, offsets aside, stopping at the first difference: serializing every region of the draft
        // and every editor to compare them was most of a reply's apply on a table-heavy page. The editor in the
        // region's own place is also compared serialized, as authored markup: a served tree and the page's parse may
        // spell the same markup with different fields.
        for (let i = from; i < live.length; i++) {
          const shown = decided.shown[i]!;
          if (sameNodes(shown, region.nodes) || (i === from && serializeJsx(shown) === serializeJsx(region.nodes))) { found = i; break; }
        }
        if (found >= 0) {
          const editor = live[found]!;
          const blocks = region.nodes.flatMap((_, offset) => {
            const el = byPath.get([region.parentPath, String(region.start + offset)].filter(Boolean).join('.'));
            return el ? [el] : [];
          });
          // The draft must draw exactly what the editor stands in for: the same blocks, in one parent, compiled alike —
          // or, for the editor holding the caret, the prose it shows (it typed the change): rebuilding it under the
          // caret threw away its focus and paid a style pass of the whole page.
          if (blocks.length && blocks.every((el) => el.parentNode === blocks[0]!.parentNode) && !inIsland(blocks[0]!) && !inIsland(editor.mount)) {
            const key = compiledKey(blocks);
            if (key === restoreKeyOf(editor) || editor === decided.focused) {
              from = found + 1;
              decided.matches.push({ region, editor, blocks, key });
            }
          }
        }
        if (index < regions.length && !more()) return false;
      }
      return true;
    }
    return decided;
  };
  return {
    flush() { for (const editor of mounted.values()) { const view = editor.view(); if (view) flushFlowView(view); } },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup(); },
    prepareHold(next, draft, more) {
      if (!plan || plan.next !== next || plan.draft !== draft || !planCurrent(plan)) plan = planHold(next, draft);
      return plan.step(more);
    },
    hold(next, draft) {
      // Decided ahead in slices (`prepareHold`) when nothing it read has moved since; decided here otherwise.
      const decided = plan && plan.next === next && plan.draft === draft && planCurrent(plan) ? plan : planHold(next, draft);
      plan = null;
      decided.step(() => true);
      const stands = new Map<string, HTMLElement>();
      const taken = new Map<string, RegionEditor>();
      const doc = root.ownerDocument;
      /** What `release` puts back: each held editor's blocks before the hold, and its stand-in in the draft. */
      const undo: Array<{ editor: RegionEditor; restore: HTMLElement[]; restoreKey: string | undefined; stand: HTMLElement; blocks: HTMLElement[] }> = [];
      for (const { region, editor, blocks, key } of decided.matches) {
        const stand = draft.ownerDocument.createElement('div');
        stand.setAttribute(EDIT_REGION_ATTR, region.path);
        blocks[0]!.parentNode!.insertBefore(stand, blocks[0]!);
        for (const block of blocks) block.remove();
        const own = { editor, restore: editor.restore, restoreKey: editor.restoreKey, stand, blocks: [] as HTMLElement[] };
        undo.push(own);
        // Leaving shows the draft's blocks (their paths are the draft's).
        editor.restore = own.blocks = blocks.map((block) => doc.adoptNode(block));
        editor.restoreKey = key;
        stands.set(region.path, editor.mount);
        taken.set(region.path, editor);
        holding.add(editor);
      }
      return {
        stands,
        take(path) { const editor = taken.get(path); taken.delete(path); if (editor) holding.delete(editor); return editor; },
        dispose() { for (const editor of taken.values()) { holding.delete(editor); editor.dispose(); } taken.clear(); },
        release() {
          for (const { editor, restore, restoreKey, stand, blocks } of undo) {
            stand.replaceWith(...blocks);
            // Unless the editor adopted newer blocks meanwhile (a draft of its own typing, reconciled in place).
            if (editor.restore === blocks) { editor.restore = restore; editor.restoreKey = restoreKey; }
            holding.delete(editor);
          }
          undo.length = 0;
          taken.clear();
        },
      };
    },
    reconcile(before, after, next, draft, options = {}) {
      const was = proseRegions(before), now = proseRegions(after), into = proseRegions(next);
      if (was.length !== now.length || now.length !== into.length || now.some((region, i) => region.path !== was[i]!.path || region.path !== into[i]!.path)) return false;
      if (!sameMaps(outsideProse(before, was), outsideProse(after, now))) return false;
      const text = (region: ProseRegion, source: string | undefined): string | null => {
        const first = region.nodes[0] as { start?: unknown } | undefined, last = region.nodes.at(-1) as { end?: unknown } | undefined;
        return source !== undefined && typeof first?.start === 'number' && typeof last?.end === 'number' ? source.slice(first.start, last.end) : null;
      };
      const changed = new Set<string>(), ahead = new Set<string>();
      for (const [i, region] of now.entries()) {
        const old = was[i]!;
        // Unchanged text since the tree on screen: nothing to compare (the editors show it).
        const a = text(old, options.beforeSource), b = text(region, options.afterSource);
        if (a !== null && a === b) continue;
        const editor = mounted.get(region.path);
        const view = editor?.view();
        if (!editor) { if (proseKey(region.nodes) !== proseKey(old.nodes)) return false; continue; }
        if (!view) return false;
        // A mounted editor shows the draft's prose already (it typed it), or — the source moved under it (an
        // undo, a remote document) — takes it in place when the caller says the draft is the source now.
        const shown = sourceNodes(view.state.doc), wanted = sourceNodes(editorDocument(region.nodes));
        if (serializeJsx(shown) !== serializeJsx(wanted)) {
          // Only TEXT is taken in place: blocks split, joined, restyled or resized are drawn (their chrome and
          // previews belong to the drawn page).
          if (shapeKey(shown) !== shapeKey(wanted)) return false;
          // A typed draft the editor has already passed: this editor handed exactly that text over at a pause and
          // typing went on while it travelled, so it shows newer text in the same blocks. The editor keeps its text
          // (the next hand-over brings the source up to it); compiling the older draft would redraw the page under
          // the caret. Text the editor never handed over (an undo, a remote edit) is not this and is refused.
          if (!options.sync && b !== null && editor.handedOver(b)) { ahead.add(region.path); continue; }
          if (!options.sync) return false;
          changed.add(region.path);
        }
      }
      const doc = root.ownerDocument;
      for (const [i, region] of into.entries()) {
        const editor = mounted.get(region.path);
        if (!editor || ahead.has(region.path)) continue;
        const a = text(was[i]!, options.beforeSource), b = text(now[i]!, options.afterSource);
        if (a !== null && a === b && !changed.has(region.path)) continue;
        editor.adopt(region.nodes, () => draft
          ? region.nodes.flatMap((_, offset) => {
            const el = draft.querySelector<HTMLElement>(`[data-mx-ast="${CSS.escape([region.parentPath, String(region.start + offset)].filter(Boolean).join('.'))}"]`);
            return el ? [doc.importNode(el, true) as HTMLElement] : [];
          })
          : [...(editor.view()?.dom.children ?? [])].map((el) => el.cloneNode(true) as HTMLElement));
      }
      return true;
    },
  };
}
