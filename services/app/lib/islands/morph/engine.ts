/**
 * THE LIVE MORPH ENGINE (docs/phase2-architecture.md §2.4, §7.2): a compiled page brought to the
 * document's newest version IN PLACE, as today's React reader re-renders a write — no navigation, the
 * reader's place, mode, focus, values and rows kept, a chart that did not change keeping its element.
 *
 * Framework-free and standalone (scripts/build-islands `STANDALONE_LAZY`): loaded only when a version
 * lands, by the one update path (../live-update), never part of the shared runtime's rt+boot closure.
 * The Solid work — hydrating an island — is the running document's own (boot's `IslandMorphSeam`); this
 * module matches, and moves DOM.
 *
 *  1. FETCH the new version's story fragment (`/a/:id/story`, lib/compiled-page/story-fragment): the same
 *     assembler output the page was served, for this page's surface and query string (its `$` values).
 *     A version the server has not compiled yet answers 409 and is asked again, briefly.
 *  2. MATCH islands. The new page's module (imported: its `boot` hands `{ ISLANDS, FLOW }` to the running
 *     document instead of booting a second one) names each island's KEY, a digest of its definition. An
 *     island is KEPT when an island with the same root element id (the persistent node id every body
 *     element carries) was running with the same key; every other running island is disposed.
 *  3. MORPH the story keyed by element ids: a matched static element keeps its node and takes the new
 *     attributes and children; text is updated in place; a kept island's nodes are moved into place
 *     untouched (their hydration keys renamed when the island's position changed); a changed or new
 *     island is the new page's served markup.
 *  4. HYDRATE the changed and new islands on the SAME context: the store (with the new declarations,
 *     `replaceFlow`, only when they changed), the reader's values and the snapshot rows survive.
 *
 * Anything it cannot do throws, and the caller reloads keeping the reader's place (../live-update).
 */
import { DOCUMENT_MODULE_PATH, ISLAND_DATA_ID, ISLANDS_PATH } from '@/lib/compiled-page/contract';
import { storyFragmentUrl, type StorySurface } from '@/lib/compiled-page/story-fragment';
import { applyAnchor, currentAnchor } from '@/lib/story-runtime/anchor';
import { readerMode } from '@/lib/story-runtime/reader-mode';
import { writeUrlValues } from '@/lib/story/url-values';
import { AST_PATH_ATTR } from '@/lib/story-ui/ast-path';
import { ISLAND_DOCUMENT_KEY, type IslandHost } from '../contract';
import type { IslandEntry, IslandModule, IslandMorphSeam, MorphableIslandDocument } from '../boot';
import type { StoryUpdateOptions } from '../live-update';

const STORY_ROOT_SELECTOR = '[data-mx-inline-story]';
const LIVE_ID_ATTR = 'data-mx-live-id';
const LIVE_EDIT_ATTR = 'data-mx-live-edit';
const HK = 'data-hk';
/** A compiler-generated render id (`s<i>-`), as rt's `hydrateIsland` accepts one. */
const RENDER_ID = /^[\w-]+$/;
/** Sheets that belong to one version and may be absent from the next (lib/story/document-styles, the assembler). */
const VERSION_SHEETS = ['data-mx-tw', 'data-mx-story-css', 'data-mx-webfonts', 'data-mx-font-vars', 'data-mx-author'];
/** How often a version the server is still compiling is asked for again, and how long apart. */
const NOT_READY_RETRIES = 6;
const NOT_READY_DELAY_MS = 250;

/** A new version this engine will not draw in place: the caller reloads. */
export class MorphRefused extends Error {}
const refuse = (why: string): MorphRefused => new MorphRefused(why);

export interface MorphDependencies {
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** Import a document module by URL (its `boot` runs on first import only). */
  importModule?: (url: string) => Promise<unknown>;
  /** Which page asks; decided from the origin when absent (a `/raw` copy's is opaque). */
  surface?: StorySurface;
}

export type MorphOptions = StoryUpdateOptions & MorphDependencies;

const defaultImport = (url: string): Promise<unknown> => import(/* @vite-ignore */ url);

export async function morphStory(win: Window, options: MorphOptions = {}): Promise<void> {
  const doc = win.document;
  const root = doc.querySelector<HTMLElement>(STORY_ROOT_SELECTOR);
  const id = doc.body?.getAttribute(LIVE_ID_ATTR);
  if (!root || !id) throw refuse('the page has no live story');
  const surface = options.surface ?? (win.origin === 'null' ? 'raw' : 'app');

  const running = (root as IslandHost)[ISLAND_DOCUMENT_KEY] as MorphableIslandDocument | undefined;
  const seam = running?.morph ?? null;
  if (running && running.mode() !== 'read') throw refuse('the document is being edited');

  // The fragment is rendered at the reader's CURRENT values (as a link to them would be), so an island it
  // hydrates matches the store it joins; the page's own query string rides along (`reader=`, the rest).
  const store = running?.store ?? null;
  const search = store ? writeUrlValues(win.location.search, store.flow, store.getState().values) : win.location.search;
  const next = await fetchFragment(win, storyFragmentUrl(id, search, surface), options.fetch ?? win.fetch.bind(win), surface);
  const nextRoot = next.querySelector<HTMLElement>(STORY_ROOT_SELECTOR);
  if (!nextRoot) throw refuse('the fragment carries no story');
  const nextEdit = next.body.getAttribute(LIVE_EDIT_ATTR);
  if (nextEdit && nextEdit === doc.body.getAttribute(LIVE_EDIT_ATTR)) return;
  const authorChanged = authorScriptOf(doc) !== authorScriptOf(next);

  const oldModule = moduleUrl(doc);
  const newModule = moduleUrl(next);
  // Content-addressed chunks: another boot URL is another island build, whose islands would run on a second Solid.
  if (oldModule && newModule && bootUrl(doc) !== bootUrl(next)) throw refuse('the island build changed under the page');

  // What the new version runs: nothing changed when the module is the same file (it is content-addressed).
  const importModule = options.importModule ?? defaultImport;
  // Absolute, as the page's own script resolved it: one URL is one module instance.
  const newModuleHref = newModule ? new URL(newModule, doc.baseURI).href : null;
  let incoming: IslandModule | null = null;
  if (seam && newModuleHref && newModule !== oldModule) {
    // Generated modules read their literal carrier at evaluation. Lend the next version's
    // carrier before importing; the current story stays untouched until import succeeds.
    const nextLiterals = next.querySelector<HTMLScriptElement>('script[data-mx-island-literals]');
    const temporaryLiterals = nextLiterals ? doc.importNode(nextLiterals, true) : null;
    if (temporaryLiterals) doc.body.append(temporaryLiterals);
    try { incoming = await takeModule(seam, newModuleHref, importModule); }
    finally { temporaryLiterals?.remove(); }
    if (incoming.FLOW && !store) throw refuse('the new version declares data the running islands have no store for');
    // The new module selected its own pinned resource. Fetch before touching the adopted tree:
    // a failure leaves the old document intact for the caller's reload path.
  }

  // The islands to keep (new render id → old), and the ones to let go.
  const oldUnits = seam ? unitsOf(root, [...seam.islands.keys()]) : new Map<string, Element[]>();
  const keep = new Map<string, string>();
  if (seam && newModule && newModule === oldModule) {
    for (const rid of seam.islands.keys()) if (oldUnits.has(rid)) keep.set(rid, rid);
  } else if (seam && incoming) {
    const byRootId = new Map<string, string>();
    for (const [rid, nodes] of oldUnits) { const rootId = (nodes[0] as Element).id; if (rootId) byRootId.set(rootId, rid); }
    const newUnits = unitsOf(nextRoot, incoming.ISLANDS.map(([rid]) => rid));
    for (const [rid, , key] of incoming.ISLANDS) {
      const rootId = newUnits.get(rid)?.[0]?.id;
      const oldRid = rootId ? byRootId.get(rootId) : undefined;
      if (key && oldRid && seam.islands.get(oldRid)?.[0] === key && ![...keep.values()].includes(oldRid)) keep.set(rid, oldRid);
    }
  }
  if (seam) {
    const kept = new Set(keep.values());
    for (const [rid, [, dispose]] of [...seam.islands]) if (!kept.has(rid)) { seam.islands.delete(rid); dispose(); }
  }

  // Where the reader is, and what they hold.
  const anchor = firstVisibleId(root, win);
  const fallbackAnchor = anchor ? null : currentAnchor(win);
  const fallbackTop = fallbackAnchor ? topOf(root, fallbackAnchor.path) : null;
  const deck = root.querySelector('.mx-rail') || nextRoot.querySelector('.mx-rail');
  const activeRow = root.querySelector('.mx-rail-row[aria-current="true"]');
  const activeSlide = activeRow ? [...root.querySelectorAll('.mx-doc [data-mx-slide]')][[...root.querySelectorAll('.mx-rail-row')].indexOf(activeRow)]?.id : null;
  const focused = doc.activeElement instanceof HTMLElement && root.contains(doc.activeElement) ? doc.activeElement : null;

  const override = options.mode?.() ?? readerMode(win);
  syncAttributes(root, nextRoot, override);
  morphChildren(root, nextRoot, { keep, oldUnits, used: new Set(), kept: new Set([...keep.values()].filter((rid) => rid !== 'd-').flatMap((rid) => oldUnits.get(rid) ?? [])), preserveCharts: !!newModule && newModule === oldModule });

  syncHead(doc, next, { adopted: !!options.adopted, override });
  const data = next.getElementById(ISLAND_DATA_ID);
  if (data) {
    const here = doc.getElementById(ISLAND_DATA_ID);
    if (here) here.textContent = data.textContent;
    else doc.body.append(doc.importNode(data, true));
  }
  if (nextEdit) doc.body.setAttribute(LIVE_EDIT_ATTR, nextEdit);

  if (seam) {
    // Kept islands answer to their new render ids from here on.
    const byOld = new Map(seam.islands);
    seam.islands.clear();
    for (const [rid, oldRid] of keep) { const island = byOld.get(oldRid); if (island) seam.islands.set(rid, island); }
    if (incoming) {
      if (incoming.FLOW && store && JSON.stringify(incoming.FLOW) !== JSON.stringify(store.flow)) store.replaceFlow({ flow: incoming.FLOW });
      for (const entry of incoming.ISLANDS) if (!keep.has(entry[0])) seam.hydrate(entry);
    }
  } else if (newModuleHref) {
    // The page ran no islands (prose until now): the new version's module boots them on this very DOM.
    await importModule(newModuleHref);
  }

  // The page's record of what it runs is the new version's now: the next version compares against it.
  syncModuleRecord(doc, next);
  if (authorChanged && seam) await seam.restartAuthor(authorScriptOf(next));
  if (deck) doc.dispatchEvent(new CustomEvent('mx:deck-morphed', { detail: { slideId: activeSlide } }));

  if (focused && !focused.isConnected && focused.id) doc.getElementById(focused.id)?.focus({ preventScroll: true });
  if (anchor) {
    const after = doc.getElementById(anchor.id)?.getBoundingClientRect().top;
    if (after !== undefined && Math.abs(after - anchor.top) > 1) win.scrollBy({ top: after - anchor.top });
  } else if (fallbackAnchor && fallbackTop !== null) {
    const after = topOf(root, fallbackAnchor.path);
    if (after !== null && Math.abs(after - fallbackTop) > 1) applyAnchor(win, fallbackAnchor);
  }
}

/* ──────────────────────────────────────────────────────────────────────────
 * The fragment and the new module
 * ────────────────────────────────────────────────────────────────────────── */

async function fetchFragment(win: Window, url: string, fetchFn: NonNullable<MorphDependencies['fetch']>, surface: StorySurface): Promise<Document> {
  for (let attempt = 0; ; attempt++) {
    // A sandboxed /raw copy has an opaque origin. Its existing export key, when present on the
    // page address, admits this same fragment door without cookies; a credentialed CORS fetch
    // from Origin:null would expose a session to unrelated sandboxed pages.
    const keyedRaw = surface === 'raw' && win.origin === 'null' && new URL(url, win.document.baseURI).searchParams.has('key');
    const response = await fetchFn(url, { credentials: keyedRaw ? 'omit' : 'same-origin', cache: 'no-store' });
    // Compiled off the write's path: a version this fresh may still be compiling.
    if (response.status === 409 && attempt < NOT_READY_RETRIES) {
      await new Promise((resolve) => win.setTimeout(resolve, NOT_READY_DELAY_MS * (attempt + 1)));
      continue;
    }
    if (!response.ok) throw refuse(`the story fragment answered ${response.status}`);
    return new DOMParser().parseFromString(await response.text(), 'text/html');
  }
}

/** First visible content element by persistent id, independent of an AST path shifted by an insertion. */
function firstVisibleId(root: Element, win: Window): { id: string; top: number } | null {
  const candidates = [...root.querySelectorAll<HTMLElement>(`[id][${AST_PATH_ATTR}]`)]
    .filter((el) => {
      const rect = el.getBoundingClientRect();
      return rect.height > 0 && rect.height <= win.innerHeight && rect.bottom > 0 && rect.top < win.innerHeight;
    })
    .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
  const first = candidates[0];
  return first ? { id: first.id, top: first.getBoundingClientRect().top } : null;
}

/** The version's author script, as its data island names it (IslandPageData.authorScript), or null. */
function authorScriptOf(doc: Document): string | null {
  try {
    const data = JSON.parse(doc.getElementById(ISLAND_DATA_ID)?.textContent || 'null') as { authorScript?: unknown } | null;
    return typeof data?.authorScript === 'string' && data.authorScript ? data.authorScript : null;
  } catch {
    return null;
  }
}

/** The page's per-document module script, or null (a page with no islands). */
const moduleScript = (doc: Document): HTMLScriptElement | null =>
  [...doc.querySelectorAll<HTMLScriptElement>('script[type="module"][src]')]
    .find((script) => script.getAttribute('src')!.startsWith(`${DOCUMENT_MODULE_PATH}/`)) ?? null;
const moduleUrl = (doc: Document): string | null => moduleScript(doc)?.getAttribute('src') ?? null;

/** The shared boot chunk a page's module runs on (its preload), which names the island build. */
const bootLink = (doc: Document): HTMLLinkElement | null =>
  [...doc.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"][href]')]
    .find((link) => link.getAttribute('href')!.startsWith(`${ISLANDS_PATH}/boot-`)) ?? null;
const bootUrl = (doc: Document): string | null => bootLink(doc)?.getAttribute('href') ?? null;

/**
 * The page's module script and boot preload become the new version's, so the next version is compared
 * with what the page runs now (the same-module shortcut, the island-build guard). A script cloned from a
 * parsed document is already started: inserting it runs nothing (its module was imported, and a module
 * runs once per URL anyway).
 */
function syncModuleRecord(doc: Document, next: Document): void {
  const record = <T extends Element>(here: T | null, there: T | null, parent: Element) => {
    if (!there) { here?.remove(); return; }
    if (here?.isEqualNode(there)) return;
    const copy = doc.importNode(there, true);
    if (here) here.replaceWith(copy); else parent.append(copy);
  };
  record(moduleScript(doc), moduleScript(next), doc.body);
  record(bootLink(doc), bootLink(next), doc.head);
}

/**
 * The newer version's `{ ISLANDS, FLOW }`: its first import runs its `boot`, which hands it to the
 * running document (`seam.take`); a module this page ran before is not evaluated again, and is found
 * by its `ISLANDS`.
 */
async function takeModule(seam: IslandMorphSeam, url: string, importModule: NonNullable<MorphDependencies['importModule']>): Promise<IslandModule> {
  let taken: IslandModule | null = null;
  seam.take = (module) => { taken = module; seam.modules.set(module.ISLANDS, module); if (module.TREE) seam.trees.set(module.TREE, module); };
  let exports: { ISLANDS?: readonly IslandEntry[]; TREE?: IslandEntry[1] } | null;
  try {
    exports = (await importModule(url)) as { ISLANDS?: readonly IslandEntry[]; TREE?: IslandEntry[1] } | null;
  } finally {
    delete seam.take;
  }
  const module = taken ?? (exports?.ISLANDS ? seam.modules.get(exports.ISLANDS) : exports?.TREE ? seam.trees.get(exports.TREE) : undefined);
  if (!module) throw refuse('the new version\'s module did not hand in its islands');
  return module;
}

/* ──────────────────────────────────────────────────────────────────────────
 * Islands in a tree
 * ────────────────────────────────────────────────────────────────────────── */

/** The render id an island node answers to: its hydration key's prefix (`s3-` of `s3-0000`). */
function renderIdOf(node: Node): string | null {
  if (node.nodeType !== 1) return null;
  const key = (node as Element).getAttribute(HK);
  const dash = key ? key.indexOf('-') : -1;
  const renderId = dash > 0 ? key!.slice(0, dash + 1) : null;
  // The d- key covers the whole document; its descendants are ordinary morphable nodes.
  return renderId === 'd-' ? null : renderId;
}

/** Each island's top-level nodes (its root first), by render id: what hydration handed the island. */
function unitsOf(tree: ParentNode, renderIds: readonly string[]): Map<string, Element[]> {
  const units = new Map<string, Element[]>();
  for (const rid of renderIds) {
    if (!RENDER_ID.test(rid)) continue;
    const selector = `[${HK}^="${rid}"]`;
    const nodes = [...tree.querySelectorAll(selector)].filter((el) => !el.parentElement?.closest(selector));
    if (nodes.length) units.set(rid, nodes);
  }
  return units;
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

interface MorphContext {
  /** New render id → the running island (old render id) that stays. */
  keep: ReadonlyMap<string, string>;
  /** The running islands' top-level nodes in the current tree. */
  oldUnits: ReadonlyMap<string, Element[]>;
  /** Current nodes already placed in the new tree. */
  used: Set<Node>;
  /** Every node of a kept island: moved into place, never removed with its old parent. */
  kept: ReadonlySet<Node>;
  /** The same browser module still owns live chart drawings after a prose-only edit. */
  preserveCharts?: boolean;
  /** Unchanged authored components whose painted root survives a draft compile. */
  stableElementIds?: ReadonlySet<string>;
  stableElementPaths?: ReadonlySet<string>;
}

type Movable = Element & { moveBefore?: (node: Node, child: Node | null) => void };

/** Put `node` before `ref` under `parent`, keeping its state where the browser can (iframes, focus). */
function move(parent: Element, node: Node, ref: Node | null): void {
  const moveBefore = (parent as Movable).moveBefore;
  if (typeof moveBefore === 'function' && node.isConnected && parent.isConnected) {
    try { moveBefore.call(parent, node, ref); return; } catch { /* not movable here: insert instead */ }
  }
  parent.insertBefore(node, ref);
}

function morphChildren(from: Element, to: Element, ctx: MorphContext): void {
  const doc = from.ownerDocument;
  const olds = [...from.childNodes];
  const byId = new Map<string, Element>();
  const byPath = new Map<string, Element>();
  for (const node of olds) if (node.nodeType === 1 && (!renderIdOf(node) || ctx.stableElementIds?.has((node as Element).id)) && (node as Element).id)
    byId.set((node as Element).id, node as Element);
  for (const node of olds) if (node.nodeType === 1) {
    const path = (node as Element).getAttribute(AST_PATH_ATTR);
    if (path && ctx.stableElementPaths?.has(path)) byPath.set(path, node as Element);
  }
  let at: ChildNode | null = from.firstChild;
  const place = (node: Node) => {
    ctx.used.add(node);
    if (node === at) { at = at.nextSibling; return; }
    move(from, node, at);
  };
  const placedIslands = new Set<string>();
  const nextIds = new Set<string>();
  for (const node of to.childNodes) if (node.nodeType === 1 && (node as Element).id) nextIds.add((node as Element).id);

  for (const next of [...to.childNodes]) {
    const rid = renderIdOf(next);
    if (rid) {
      const oldRid = ctx.keep.get(rid);
      if (oldRid === undefined) {
        const id = (next as Element).id;
        const stable = id && ctx.stableElementIds?.has(id) ? byId.get(id) : undefined;
        const path = (next as Element).getAttribute(AST_PATH_ATTR);
        const byStablePath = path && ctx.stableElementPaths?.has(path) ? byPath.get(path) : undefined;
        const retained = stable ?? byStablePath;
        place(retained && sameKind(retained, next) ? retained : doc.importNode(next, true));
        continue;
      }
      // A kept island: every node it runs, where the new page has it, once.
      if (placedIslands.has(rid)) continue;
      placedIslands.add(rid);
      for (const node of ctx.oldUnits.get(oldRid) ?? []) {
        if (rid !== oldRid) renameIsland(node, oldRid, rid);
        place(node);
      }
      continue;
    }
    // By persistent id first; else (no id, or an id the current page does not have — a node minted anew)
    // the next free node of the same kind whose own id the new version no longer names.
    const byOwnId = next.nodeType === 1 && (next as Element).id ? byId.get((next as Element).id) : undefined;
    const path = next.nodeType === 1 ? (next as Element).getAttribute(AST_PATH_ATTR) : null;
    const byStablePath = path && ctx.stableElementPaths?.has(path) ? byPath.get(path) : undefined;
    const match = byOwnId && !ctx.used.has(byOwnId) ? byOwnId
      : byStablePath && !ctx.used.has(byStablePath) ? byStablePath : softMatch(at, next, ctx, nextIds);
    if (match && !ctx.used.has(match) && sameKind(match, next)) {
      if (match.nodeType === 1) {
        const oldElement = match as Element;
        const newElement = next as Element;
        const sameChart = ctx.preserveCharts && oldElement.getAttribute('aria-label') === 'Question embed'
          && newElement.getAttribute('aria-label') === 'Question embed'
          && oldElement.getAttribute(AST_PATH_ATTR) === newElement.getAttribute(AST_PATH_ATTR);
        if (!sameChart && !ctx.stableElementIds?.has(oldElement.id)
          && !(path && ctx.stableElementPaths?.has(path))) {
          syncAttributes(oldElement, newElement, null);
          morphChildren(oldElement, newElement, ctx);
        }
      } else if (match.nodeValue !== next.nodeValue) {
        match.nodeValue = next.nodeValue;
      }
      place(match);
      continue;
    }
    place(fresh(doc, next, ctx));
  }
  for (const node of olds) if (!ctx.used.has(node) && !ctx.kept.has(node) && node.parentNode === from) from.removeChild(node);
}

/** Morph an unsaved editor compile in the adopted root. Only caller-approved component IDs keep
 * their hydrated DOM; a changed component takes the compiler's fresh static preview instead. */
export function morphDraftDom(root: HTMLElement, next: HTMLElement, stableComponentIds: ReadonlySet<string>, stableComponentPaths: ReadonlySet<string> = new Set()): void {
  const renderIds = (tree: ParentNode) => [...new Set([...tree.querySelectorAll(`[${HK}]`)].map(renderIdOf).filter((id): id is string => !!id))];
  const oldUnits = unitsOf(root, renderIds(root));
  const nextUnits = unitsOf(next, renderIds(next));
  const oldById = new Map([...oldUnits].map(([rid, elements]) => [elements[0]?.id, rid] as const));
  const keep = new Map<string, string>();
  for (const [rid, elements] of nextUnits) {
    const id = elements[0]?.id;
    const oldRid = id && stableComponentIds.has(id) ? oldById.get(id) : undefined;
    if (oldRid && ![...keep.values()].includes(oldRid)) keep.set(rid, oldRid);
  }
  const kept = new Set<Node>([...keep.values()].flatMap((rid) => oldUnits.get(rid) ?? []));
  syncAttributes(root, next, null);
  morphChildren(root, next, { keep, oldUnits, used: new Set(), kept, stableElementIds: stableComponentIds, stableElementPaths: stableComponentPaths });
}

/** Release only changed draft islands before their compiled roots are morphed. */
export function disposeChangedDraftIslands(root: HTMLElement, stableIds: ReadonlySet<string>, stablePaths: ReadonlySet<string>): void {
  const running = (root as IslandHost)[ISLAND_DOCUMENT_KEY] as MorphableIslandDocument | undefined;
  const seam = running?.morph;
  if (!seam) return;
  for (const [rid, [, dispose]] of [...seam.islands]) {
    const element = unitsOf(root, [rid]).get(rid)?.[0];
    // A one-tree root spans every component; one stable child cannot retain its old reactive owner.
    if (rid !== 'd-' && element && (stableIds.has(element.id) || stablePaths.has(element.getAttribute(AST_PATH_ATTR) ?? ''))) continue;
    seam.islands.delete(rid);
    dispose();
  }
}

/** Boot newly compiled draft islands on the existing store after their static DOM is in place. */
export async function hydrateDraftIslands(
  win: Window,
  root: HTMLElement,
  preview: Document,
  stableIds: ReadonlySet<string>,
  stablePaths: ReadonlySet<string>,
  importModule: NonNullable<MorphDependencies['importModule']> = defaultImport,
): Promise<void> {
  const running = (root as IslandHost)[ISLAND_DOCUMENT_KEY] as MorphableIslandDocument | undefined;
  const seam = running?.morph;
  const script = moduleScript(preview);
  if (!seam || !script) return;
  const url = new URL(script.getAttribute('src')!, win.document.baseURI).href;
  const literals = preview.querySelector<HTMLScriptElement>('script[data-mx-island-literals]');
  const carrier = literals ? win.document.importNode(literals, true) : null;
  if (carrier) win.document.body.append(carrier);
  let module: IslandModule;
  try { module = await takeModule(seam, url, importModule); }
  finally { carrier?.remove(); }
  if (module.FLOW && running.store && JSON.stringify(module.FLOW) !== JSON.stringify(running.store.flow))
    running.store.replaceFlow({ flow: module.FLOW });
  for (const entry of module.ISLANDS) {
    // Editing paints the server draft and retains stable component DOM. Hydrating the whole
    // browser tree here would replace static runs with its empty NoHydration placeholders.
    if (entry[0] === 'd-' && running.mode?.() === 'edit') continue;
    const element = unitsOf(root, [entry[0]]).get(entry[0])?.[0];
    if (!element || (entry[0] !== 'd-' && (stableIds.has(element.id) || stablePaths.has(element.getAttribute(AST_PATH_ATTR) ?? '')))) continue;
    seam.hydrate(entry);
  }
}

/** A new node that matched nothing: an element is built through the morph, so a kept island inside it still lands. */
function fresh(doc: Document, next: Node, ctx: MorphContext): Node {
  if (next.nodeType !== 1) return doc.importNode(next, false);
  const element = doc.importNode(next, false) as Element;
  morphChildren(element, next as Element, ctx);
  return element;
}

/**
 * The next unplaced current sibling a node can be when its id matched nothing: same type and tag, not an
 * island, and not an element the new version still names by its own id (that one waits for its match).
 */
function softMatch(from: ChildNode | null, next: Node, ctx: MorphContext, nextIds: ReadonlySet<string>): Node | null {
  for (let node = from; node; node = node.nextSibling) {
    if (ctx.used.has(node) || ctx.kept.has(node) || renderIdOf(node)) continue;
    if (node.nodeType === 1 && (node as Element).id && nextIds.has((node as Element).id)) continue;
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
function syncAttributes(from: Element, to: Element, override: 'light' | 'dark' | null): void {
  for (const attr of [...from.attributes]) if (!to.hasAttributeNS(attr.namespaceURI, attr.localName)) from.removeAttributeNS(attr.namespaceURI, attr.localName);
  for (const attr of [...to.attributes]) {
    let value = attr.value;
    if (override && attr.name === 'class' && from.hasAttribute('data-mx-inline-story')) value = withMode(value, override);
    if (from.getAttributeNS(attr.namespaceURI, attr.localName) !== value) from.setAttributeNS(attr.namespaceURI, attr.name, value);
  }
}

const withMode = (classes: string, mode: 'light' | 'dark'): string =>
  [...classes.split(/\s+/).filter((c) => c && c !== 'light' && c !== 'dark'), mode].join(' ');

/* ──────────────────────────────────────────────────────────────────────────
 * The page around the story
 * ────────────────────────────────────────────────────────────────────────── */

/** The version's sheets (new classes, fonts, the author's own CSS), its title, and the document's colour. */
function syncHead(doc: Document, next: Document, { adopted, override }: { adopted: boolean; override: 'light' | 'dark' | null }): void {
  const sheetKey = (style: Element): string | null => [...style.attributes].find((a) => a.name.startsWith('data-mx-'))?.name ?? null;
  const incoming = new Map<string, string>();
  for (const style of next.head.querySelectorAll('style')) { const key = sheetKey(style); if (key) incoming.set(key, style.textContent ?? ''); }
  const present = new Set<string>();
  for (const style of [...doc.head.querySelectorAll('style')]) {
    const key = sheetKey(style);
    if (!key) continue;
    present.add(key);
    const css = incoming.get(key);
    if (css === undefined) { if (VERSION_SHEETS.includes(key)) style.remove(); continue; }
    if (style.textContent !== css) style.textContent = css;
  }
  for (const [key, css] of incoming) {
    if (present.has(key)) continue;
    const style = doc.createElement('style');
    style.setAttribute(key, '');
    style.textContent = css;
    doc.head.append(style);
  }
  if (adopted) return;
  // The page's own title and colour are the story's until the app holds the page.
  const title = next.querySelector('title')?.textContent;
  if (title && doc.title !== title) doc.title = title;
  const html = doc.documentElement;
  const theme = next.documentElement.getAttribute('data-theme');
  if (theme) html.setAttribute('data-theme', theme); else html.removeAttribute('data-theme');
  if (!override) {
    const mode = next.documentElement.classList.contains('dark') ? 'dark' : 'light';
    html.classList.toggle('dark', mode === 'dark');
    html.classList.toggle('light', mode !== 'dark');
  }
}

/** Where the element the reader's anchor names sits in the viewport now, or null. */
function topOf(root: Element, path: string): number | null {
  const el = [...root.querySelectorAll(`[${AST_PATH_ATTR}]`)].find((candidate) => candidate.getAttribute(AST_PATH_ATTR) === path);
  return el ? el.getBoundingClientRect().top : null;
}
