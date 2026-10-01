/** @jsxImportSource solid-js */
/** Attach prose editing to the compiler's `data-mx-ast` DOM without interpreting the document again. */
import { createSignal, type Setter } from 'solid-js';
import { render } from 'solid-js/web';
import { serializeJsx, type JsxNode } from '@/lib/jsx';
import { editorDocument, isProseTree, sourceNodes } from '@/lib/editor-v2/model';
import type { EditorSelectionChange } from '@/lib/editor-v2/bookmark';
import type { EditorView } from 'prosemirror-view';
import { isEditableTextHost } from '@/lib/story-ui/host-classify';
import { gridCols, gridItemRect, gridRowHeight } from '@/lib/story-ui/grid-layout';
import { STORY_GRID_EDIT_CSS } from '@/lib/story-ui/grid-css';
import type { StoryLayoutRect } from '@/lib/story-runtime/contract';
import { FlowEditor } from '@/solid/editor/FlowEditor';
import { GridEdit, type GridTile } from '@/solid/editor/GridEdit';
import { discoverSlides } from '@/lib/story-runtime/slides';

export interface CompiledEditCallbacks {
  onFlow(path: string, expected: string, replacement: string, group?: string, selection?: EditorSelectionChange): void;
  onLayout?(rects: StoryLayoutRect[]): void;
  onSlideTitle?(path: string, title: string): void;
  onError?(message: string): void;
  onBusy?(busy: boolean): void;
  onView?(view: EditorView | null): void;
  onHostFocus?(path: string, element: HTMLElement): void;
  onHostInput?(path: string): void;
  onHostBlur?(path: string): void;
}

export interface CompiledEditMount {
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
export const REGION_HEIGHT_VAR = '--mx-region-h';
/** How many recent hand-overs an editor remembers: drafts in flight are one or two behind it. */
const HANDED_KEPT = 8;
/**
 * How long an off-screen mount slice may build editors (one region at least). The page's own style pass for what a
 * slice inserted follows at the next frame; on a table-heavy page that pass, not the editors, is most of the time.
 */
const SLICE_MS = 50;
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

/** The prose runs the mounter gives one editor each, by the same walk as `visit` (without the DOM). */
export function proseRegions(nodes: JsxNode[]): ProseRegion[] {
  const regions: ProseRegion[] = [];
  const walk = (siblings: JsxNode[], parentPath: string) => {
    for (let index = 0; index < siblings.length;) {
      const node = siblings[index]!;
      if (!isBlock(node)) {
        if (node.type === 'element') walk(node.children, [parentPath, String(index)].filter(Boolean).join('.'));
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

/** One region replaces only its authored prose siblings; adjacent compiled islands keep their DOM identity. */
export function mountCompiledEditRegions(root: HTMLElement, nodes: JsxNode[], callbacks: CompiledEditCallbacks): CompiledEditMount {
  const cleanups: Array<() => void> = [];
  /** Every mounted prose editor, by its region's path: what `reconcile` keeps alive. */
  const mounted = new Map<string, { view: () => EditorView | null; adopt(region: JsxNode[], elements: () => HTMLElement[]): void; handedOver(text: string): boolean }>();
  // GridEdit's grip/resize affordances (STORY_GRID_EDIT_CSS's [data-mx-grid-tile]/.mx-grid-resize
  // rules) are structural, not authored content — same reasoning as the React adapter's own
  // `<style data-mx-grid-css>`, injected inside the story surface rather than the app's <head>.
  if (!root.querySelector('style[data-mx-grid-css]')) {
    const style = root.ownerDocument.createElement('style');
    style.dataset.mxGridCss = '';
    style.textContent = STORY_GRID_EDIT_CSS;
    root.prepend(style);
    cleanups.push(() => style.remove());
  }
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
  const mountRegion = ({ path, region, elements, parent, layout, placement, height }: RegionMount) => {
    if (!elements.every((el) => el.isConnected && el.parentElement === parent)) return;
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
    let restore = elements;
    const [current, setCurrent] = createSignal(region) as [() => JsxNode[], Setter<JsxNode[]>];
    const disposeSolid = render(() => <FlowEditor nodes={current()} path={path}
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
    mounted.set(path, {
      view: () => liveView,
      handedOver: (text) => handed.includes(text.trim()),
      adopt(next, compiled) {
        previous = next;
        setCurrent(() => next);
        const blocks = compiled();
        if (blocks.length) restore = blocks;
      },
    });
    // The editor root replaces the region's blocks as ONE child of their parent; under a flex or
    // grid parent it adopts that layout (edit-mode CSS) so the blocks lay out as they read.
    // The whole content of a flex/grid parent: the root fills it and adopts its layout. Beside
    // other items it stays one item, placed as its single block was. Set on the wrapper, not
    // the editor root: ProseMirror owns its root's attributes.
    if (layout) mount.setAttribute('data-mx-parent-layout', Array.from(parent.children).every((child) => child === mount) ? layout : 'item');
    cleanups.push(() => {
      mounted.delete(path);
      if (mount.isConnected) {
        // The compiled blocks of the last draft adopted, so leaving shows what was typed.
        for (const element of restore) parent.insertBefore(element, mount);
        mount.remove();
      }
      // Torn down off the page, as it was built: removing an editable root in place brought the page's styles up to
      // date at every region.
      disposeSolid();
    });
  };
  visit(nodes, '');
  for (const host of hosts) host();
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
  const run = () => {
    slice = null;
    const until = view.performance.now() + SLICE_MS;
    while (pending.length && view.performance.now() < until) mountRegion(pending.shift()!);
    if (pending.length) schedule();
  };
  if (pending.length) schedule();
  cleanups.unshift(() => {
    pending = [];
    if (slice !== null) { if (idle.cancelIdleCallback) idle.cancelIdleCallback(slice); else view.clearTimeout(slice); }
  });
  return {
    dispose() { for (const cleanup of cleanups.reverse()) cleanup(); },
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
