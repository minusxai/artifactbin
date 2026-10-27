/**
 * THE DOM MORPH shared by every live update (docs/phase2-architecture.md §2.4): `from`'s children made `to`'s, matched by
 * persistent identity, moving as few nodes as possible and never one holding an iframe or the reader's focus when its
 * siblings can move around it. Framework-free and import-light, so the compiled-story engine (./engine) and the native
 * HTML page's live morph (lib/html-runtime/live-morph) run the same matching and arrangement.
 */
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import { LIVE_DATA_ATTR } from '@/lib/story-runtime/contract';

export const HK = 'data-hk';
const elementId = (element: Element): string => element.id;

/** The render id an island node answers to: its hydration key's prefix (`s3-` of `s3-0000`). */
export function renderIdOf(node: Node): string | null {
  if (node.nodeType !== 1) return null;
  const key = (node as Element).getAttribute(HK);
  const dash = key ? key.indexOf('-') : -1;
  const renderId = dash > 0 ? key!.slice(0, dash + 1) : null;
  // The d- key covers the whole document; its descendants are ordinary morphable nodes.
  return renderId === 'd-' ? null : renderId;
}


/** A kept island at a new position answers to the new render id (its hydration keys), for the next version's matching. */
function renameIsland(node: Element, from: string, to: string): void {
  for (const el of [node, ...node.querySelectorAll(`[${HK}^="${from}"]`)]) {
    const key = el.getAttribute(HK);
    if (key?.startsWith(from)) el.setAttribute(HK, to + key.slice(from.length));
  }
}


/* ──────────────────────────────────────────────────────────────────────────
 * The morph
 * ────────────────────────────────────────────────────────────────────────── */

export interface MorphContext {
  /** An element's persistent identity: its `id` on a compiled story (the default), `data-af-id` on an HTML page; '' for none. */
  idOf?: (element: Element) => string;
  /** How a matched, changed element takes the new attributes; the default replaces them all (`syncAttributes`). */
  syncAttributes?: (from: Element, to: Element) => void;
  /** New render id → the running island (old render id) that stays. */
  keep: ReadonlyMap<string, string>;
  /** The running islands' top-level nodes in the current tree. */
  oldUnits: ReadonlyMap<string, Element[]>;
  /** Current nodes already claimed by a node of the new tree. */
  used: Set<Node>;
  /** Every node of a kept island: moved into place, never removed with its old parent. */
  kept: ReadonlySet<Node>;
  /** Whether a move would restart this node (`heldNodes`): its siblings move around it. */
  held: (node: Node) => boolean;
  /** The same browser module still owns live data widgets and charts after a prose-only edit. */
  preserveLiveData?: boolean;
  /** Unchanged authored components whose painted root survives a draft compile. */
  stableElementIds?: ReadonlySet<string>;
  /** Unchanged components without an id, by their path in the new tree → their path on the page now. */
  stableElementPaths?: ReadonlyMap<string, string>;
  /** Those components' paths on the page now. */
  stableOldPaths?: ReadonlySet<string>;
  /** Live editor roots kept across a draft, placed where the draft has their stand-in (`[data-mx-edit-region]`). */
  editRegions?: ReadonlyMap<string, Element>;
}

/** A held editor's stand-in in a draft (lib/frame-edit/dom-mounter EDIT_REGION_ATTR; not imported: no editor code here). */
const EDIT_REGION_ATTR = 'data-mx-edit-region';

type Movable = Element & { moveBefore?: (node: Node, child: Node | null) => void };

/** Put `node` before `ref` under `parent`, keeping its state where the browser can (iframes, focus). */
function move(parent: Element, node: Node, ref: Node | null): void {
  const moveBefore = (parent as Movable).moveBefore;
  if (typeof moveBefore === 'function' && node.isConnected && parent.isConnected) {
    try { moveBefore.call(parent, node, ref); return; } catch { /* not movable here: insert instead */ }
  }
  parent.insertBefore(node, ref);
}

/**
 * What a move restarts. Without `moveBefore` (Safari, Firefox before it) a move is a removal and an insertion, and a
 * node that leaves the document loses what it holds: an iframe, object or embed loads its page again (the author's
 * map, video player or sign-in starts over), and the reader's focus, caret and selection are dropped (a selection
 * whose words leave the document collapses, and the comment bubble on it closes). Each such node and every ancestor up
 * to `root`: the morph moves their siblings instead. Found once, the first time a morph has to move
 * anything (most morphs move nothing). A playing <audio>/<video> and a canvas's pixels survive a move made in one
 * task (measured in Chromium, WebKit and Firefox), so neither is held.
 */
const HELD_SELECTOR = 'iframe, object, embed';
export function heldNodes(root: Element): (node: Node) => boolean {
  let held: Set<Node> | null = null;
  return (node) => {
    if (!held) {
      const found = held = new Set<Node>();
      const hold = (node: Node | null | undefined) => {
        if (!node || !root.contains(node)) return;
        for (let at: Node | null = node; at && at !== root && !found.has(at); at = at.parentNode) found.add(at);
      };
      for (const el of root.querySelectorAll(HELD_SELECTOR)) hold(el);
      const doc = root.ownerDocument;
      hold(doc.activeElement);
      const selection = doc.defaultView?.getSelection();
      if (selection && selection.rangeCount && !selection.isCollapsed) { hold(selection.anchorNode); hold(selection.focusNode); }
    }
    return held.has(node);
  };
}

/**
 * Make `nodes` the children of `parent` in this order, from the left, moving as few as it can: the ones already
 * children in an order that agrees with `nodes` stay (the heaviest increasing run of their current places), every
 * other one is moved or inserted before the node that follows it. The weights rank what a move costs: a held node
 * outweighs every other together, so its siblings move around it; an element or text outweighs every comment
 * together, so the server render's block markers (`<!--$-->`, matched by kind and shifted by a block inserted ahead)
 * move, never the blocks. Children `nodes` does not name are left where they are (the caller removes them).
 */
function arrange(parent: Element, nodes: readonly Node[], held: (node: Node) => boolean): void {
  const place = new Map<Node, number>();
  let index = 0;
  for (let child = parent.firstChild; child; child = child.nextSibling) place.set(child, index++);
  const present = nodes.filter((node) => place.has(node));
  let ordered = true;
  for (let i = 1; i < present.length && ordered; i++) ordered = place.get(present[i - 1]!)! < place.get(present[i]!)!;
  const tier = present.length + 1;
  const weight = (node: Node) => (held(node) ? tier * tier : node.nodeType === 8 ? 1 : tier);
  const stays = ordered ? new Set(present) : heaviestIncreasing(present, place, weight, index);
  let ref: Node | null = null;
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i]!;
    if (!stays.has(node)) move(parent, node, ref);
    ref = node;
  }
}

/**
 * The heaviest subsequence of `nodes` whose current places increase: O(n log n), a Fenwick tree over places keeping,
 * for every prefix of places, the heaviest run ending there.
 */
function heaviestIncreasing(nodes: readonly Node[], place: ReadonlyMap<Node, number>, weight: (node: Node) => number, size: number): Set<Node> {
  const best = new Float64Array(size + 1);
  const end = new Int32Array(size + 1).fill(-1);
  const total = new Float64Array(nodes.length);
  const previous = new Int32Array(nodes.length);
  let top = -1;
  nodes.forEach((node, i) => {
    const at = place.get(node)!;
    let heaviest = 0, from = -1;
    for (let k = at; k > 0; k -= k & -k) if (best[k]! > heaviest) { heaviest = best[k]!; from = end[k]!; }
    total[i] = heaviest + weight(node);
    previous[i] = from;
    for (let k = at + 1; k <= size; k += k & -k) if (total[i]! > best[k]!) { best[k] = total[i]!; end[k] = i; }
    if (top < 0 || total[i]! > total[top]!) top = i;
  });
  const stays = new Set<Node>();
  for (let i = top; i >= 0; i = previous[i]!) stays.add(nodes[i]!);
  return stays;
}

/**
 * `from`'s children become `to`'s, in three passes. MATCH each new child to the current node that will stand for it
 * (nothing moves yet); ARRANGE those in the new order, moving as few as possible and never a held node its siblings
 * can move around (`arrange`); then UPDATE each in place, its own children morphed where it now stands (a kept island
 * that enters a node drawn anew moves into a connected parent, so `moveBefore` keeps it whole). The current children
 * nothing matched go last.
 */
export function morphChildren(from: Element, to: Element, ctx: MorphContext): void {
  const doc = from.ownerDocument;
  const olds = [...from.childNodes];
  const byId = new Map<string, Element>();
  const byPath = new Map<string, Element>();
  const idOf = ctx.idOf ?? elementId;
  for (const node of olds) if (node.nodeType === 1 && (!renderIdOf(node) || ctx.stableElementIds?.has(idOf(node as Element))) && idOf(node as Element))
    byId.set(idOf(node as Element), node as Element);
  for (const node of olds) if (node.nodeType === 1) {
    const path = (node as Element).getAttribute(AST_PATH_ATTR);
    if (path && ctx.stableOldPaths?.has(path)) byPath.set(path, node as Element);
  }
  /** The current node a stable component at `path` in the new tree is (its path moved when blocks moved ahead of it). */
  const stableAt = (path: string | null): Element | undefined => {
    const old = path ? ctx.stableElementPaths?.get(path) : undefined;
    return old === undefined ? undefined : byPath.get(old);
  };
  // Where an unnamed node looks for its match: the first current child nothing has claimed yet.
  let cursor = 0;
  /** Each new child's node, in order, and what is left to make it the new one once it stands in its place. */
  const nodes: Node[] = [];
  const updates: Array<() => void> = [];
  const take = (node: Node, update?: () => void) => {
    ctx.used.add(node);
    nodes.push(node);
    if (update) updates.push(update);
    while (cursor < olds.length && ctx.used.has(olds[cursor]!)) cursor++;
  };
  const placedIslands = new Set<string>();
  const nextIds = new Set<string>();
  for (const node of to.childNodes) if (node.nodeType === 1 && idOf(node as Element)) nextIds.add(idOf(node as Element));

  for (const next of [...to.childNodes]) {
    // A kept editor, as it is: never compared, synced or rebuilt.
    const editor = ctx.editRegions?.size && next.nodeType === 1 ? ctx.editRegions.get((next as Element).getAttribute(EDIT_REGION_ATTR) ?? '') : undefined;
    if (editor) { take(editor); continue; }
    const rid = renderIdOf(next);
    if (rid) {
      const oldRid = ctx.keep.get(rid);
      if (oldRid === undefined) {
        const id = idOf(next as Element);
        const stable = id && ctx.stableElementIds?.has(id) ? byId.get(id) : undefined;
        const byStablePath = stableAt((next as Element).getAttribute(AST_PATH_ATTR));
        const retained = stable ?? byStablePath;
        if (retained && sameKind(retained, next)) take(retained, () => adoptHydrationKeys(retained, next as Element));
        else take(doc.importNode(next, true));
        continue;
      }
      // A kept island: every node it runs, where the new page has it, once.
      if (placedIslands.has(rid)) continue;
      placedIslands.add(rid);
      for (const node of ctx.oldUnits.get(oldRid) ?? []) {
        if (rid !== oldRid) renameIsland(node, oldRid, rid);
        take(node);
      }
      continue;
    }
    // By persistent id first; else (no id, or an id the current page does not have — a node minted anew)
    // the next free node of the same kind whose own id the new version no longer names.
    const byOwnId = next.nodeType === 1 && idOf(next as Element) ? byId.get(idOf(next as Element)) : undefined;
    const path = next.nodeType === 1 ? (next as Element).getAttribute(AST_PATH_ATTR) : null;
    const byStablePath = stableAt(path);
    const match = byOwnId && !ctx.used.has(byOwnId) ? byOwnId
      : byStablePath && !ctx.used.has(byStablePath) ? byStablePath : softMatch(olds, cursor, next, ctx, nextIds);
    if (match && !ctx.used.has(match) && sameKind(match, next)) {
      take(match, () => update(match, next, path, ctx));
      continue;
    }
    // A new node that matched nothing: an element is built through the morph, so a kept island inside it still lands.
    const made = doc.importNode(next, false);
    take(made, next.nodeType === 1 ? () => morphChildren(made as Element, next as Element, ctx) : undefined);
  }
  arrange(from, nodes, ctx.held);
  for (const run of updates) run();
  for (const node of olds) if (!ctx.used.has(node) && !ctx.kept.has(node) && node.parentNode === from) from.removeChild(node);
}

/** A matched current node (`match`) made the new one (`next`, at `path` in the new tree), where it stands. */
function update(match: Node, next: Node, path: string | null, ctx: MorphContext): void {
  if (match.nodeType !== 1) {
    if (match.nodeValue !== next.nodeValue) match.nodeValue = next.nodeValue;
    return;
  }
  const oldElement = match as Element;
  const newElement = next as Element;
  // Same-module data adapters retain reactive rows, numbers and settled errors. Incoming SSR
  // placeholders must not overwrite DOM whose unchanged store has no reason to redraw it.
  const sameLiveData = ctx.preserveLiveData && (oldElement.hasAttribute(LIVE_DATA_ATTR) && newElement.hasAttribute(LIVE_DATA_ATTR)
    || oldElement.getAttribute('aria-label') === 'Question embed'
    && newElement.getAttribute('aria-label') === 'Question embed'
  )
    && oldElement.getAttribute(AST_PATH_ATTR) === newElement.getAttribute(AST_PATH_ATTR);
  if (!sameLiveData && !ctx.stableElementIds?.has((ctx.idOf ?? elementId)(oldElement))
    && !(path && ctx.stableElementPaths?.has(path))) {
    // An element the new version draws exactly as it is (a table the edit did not touch) stays as it is: one
    // native comparison instead of a walk over every cell.
    if (!oldElement.isEqualNode(newElement)) {
      if (ctx.syncAttributes) ctx.syncAttributes(oldElement, newElement); else syncAttributes(oldElement, newElement, null);
      morphChildren(oldElement, newElement, ctx);
    }
  } else if (!sameLiveData) adoptHydrationKeys(oldElement, newElement);
}

/**
 * A kept component answers to the new compile's hydration keys and AST paths. It is unchanged, but
 * both are positional: a block added ahead of it, or a first draft over a page served from differently
 * spaced source, moves them. Hydrating under keys the draft module cannot find renders the component
 * fresh, without its server-only static runs; stale paths hide it from the editor's mounter.
 */
function adoptHydrationKeys(kept: Element, next: Element): void {
  for (const attr of [HK, AST_PATH_ATTR]) {
    const from = [kept, ...kept.querySelectorAll(`[${attr}]`)].filter((el) => el.hasAttribute(attr));
    const to = [next, ...next.querySelectorAll(`[${attr}]`)].filter((el) => el.hasAttribute(attr));
    if (from.length !== to.length) continue;
    from.forEach((el, index) => {
      const value = to[index]!.getAttribute(attr)!;
      if (el.getAttribute(attr) !== value) el.setAttribute(attr, value);
    });
  }
}


/**
 * The first unclaimed current child from `cursor` a node can be when its id matched nothing: same type and tag, not
 * an island, and not an element the new version still names by its own id (that one waits for its match).
 */
function softMatch(olds: readonly ChildNode[], cursor: number, next: Node, ctx: MorphContext, nextIds: ReadonlySet<string>): Node | null {
  for (let i = cursor; i < olds.length; i++) {
    const node = olds[i]!;
    if (ctx.used.has(node) || ctx.kept.has(node) || renderIdOf(node)) continue;
    if (node.nodeType === 1 && (ctx.idOf ?? elementId)(node as Element) && nextIds.has((ctx.idOf ?? elementId)(node as Element))) continue;
    if (sameKind(node, next)) return node;
  }
  return null;
}

const sameKind = (a: Node, b: Node): boolean =>
  a.nodeType === b.nodeType && (a.nodeType !== 1 || (a as Element).tagName === (b as Element).tagName);

/**
 * `to`'s attributes on `from`. On the story root, `override` is the reader's own colour: the new
 * version's `light`/`dark` never replaces it.
 */
export function syncAttributes(from: Element, to: Element, override: 'light' | 'dark' | null): void {
  for (const attr of [...from.attributes]) if (!to.hasAttributeNS(attr.namespaceURI, attr.localName)) from.removeAttributeNS(attr.namespaceURI, attr.localName);
  for (const attr of [...to.attributes]) {
    let value = attr.value;
    if (override && attr.name === 'class' && from.hasAttribute('data-mx-inline-story')) value = withMode(value, override);
    if (from.getAttributeNS(attr.namespaceURI, attr.localName) !== value) from.setAttributeNS(attr.namespaceURI, attr.name, value);
  }
}

const withMode = (classes: string, mode: 'light' | 'dark'): string =>
  [...classes.split(/\s+/).filter((c) => c && c !== 'light' && c !== 'dark'), mode].join(' ');
