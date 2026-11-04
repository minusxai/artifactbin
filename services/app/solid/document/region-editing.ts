/**
 * REGION EDITING ON THE PAGE: what an editor's page does for the editable regions (`data-af-editable="rich"|"text"`)
 * of the document in its frame. An intentional lazy browser chunk (it carries Yjs through the region client), loaded by
 * create-framed-story only for a reader with edit access once the frame's controller runs.
 *
 *  - The saved page (the head an editor reads, `ArtifactBackend.load`) names the regions; the frame is told them
 *    (`regions-enabled`), and again whenever a new document's controller starts.
 *  - `region-open` from the frame opens the region's session on the server (region-http) and the frame gets
 *    `region-session`: the region's kind, its client id, its state bytes and seq — built field by field, so nothing
 *    but bytes and ids ever crosses to the frame. Updates are relayed both ways; acks and closes follow.
 *  - The page's membership (which saved identities sit inside a region) is what save-before-comment reads
 *    (lib/annotations/region-comment); it is read again after every saved version, which identifies new blocks.
 *  - `pagehide` leaves (pending edits go with keepalive; the stream closes, so the server's last-editor save runs);
 *    `pageshow` from the back-forward cache resumes.
 *  - A DOC (`autoOpen`: a page "New" made, one rich region for its whole body) is edited the moment it loads: its first
 *    region's session opens with no press, through the same messages a press sends. The first time, the frame takes
 *    the focus and is asked for the caret (`region-command` `focus`), so the person types straight into the title.
 *  - The editing chrome (solid/document/RegionToolbar) follows this person's editor: from its first caret (`region-caret`,
 *    with the marks and block there) until its session ends, the toolbar's state; `region-slash` and `region-link` ask
 *    for the slash menu and the link dialog; `command` runs a toolbar or menu command in that editor. A blur keeps the
 *    state (pressing the toolbar blurs the editor).
 */
import type { RegionFrameMessage, RegionKind, RegionParentMessage } from '@artifactbin/contracts';
import { createRegionClient, type RegionClient, type RegionClientEvents } from '@/lib/artifact-backend/region-http';
import type { RegionMembership } from '@/lib/annotations/region-comment';

export interface PageRegions extends RegionMembership { regions: Array<{ id: string; kind: RegionKind }> }

/** The editable regions of a saved page and its identities (every one, and those inside a region), read with the browser's parser. */
export function regionMembership(html: string): PageRegions {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const regions: PageRegions['regions'] = [];
  const inside = new Set<string>(), known = new Set<string>();
  for (const element of document.querySelectorAll('[data-af-id]')) known.add(element.getAttribute('data-af-id')!);
  for (const element of document.querySelectorAll('[data-af-editable]')) {
    const kind = element.getAttribute('data-af-editable'), id = element.getAttribute('data-af-id');
    if ((kind !== 'rich' && kind !== 'text') || !id) continue;
    // A region inside another region's text is not one of its own (the outer one owns its content).
    const outer = element.parentElement?.closest('[data-af-editable]');
    if (outer && ['rich', 'text'].includes(outer.getAttribute('data-af-editable') ?? '')) continue;
    regions.push({ id, kind });
    inside.add(id);
    for (const child of element.querySelectorAll('[data-af-id]')) inside.add(child.getAttribute('data-af-id')!);
  }
  return { regions, inside, known };
}

/** The toolbar's state: this person's region editor, and the marks and block at its caret. */
export interface RegionToolbarState { regionId: string; kind: RegionKind; marks: string[]; block: string }

interface RegionBridge {
  sendRegion(message: RegionParentMessage): void;
  subscribeRegion(listener: (message: RegionFrameMessage) => void): () => void;
}

export interface RegionEditingOptions {
  id: string;
  bridge: RegionBridge;
  /** The saved head's HTML, as an editor reads it; null when unavailable. */
  loadHtml(): Promise<string | null>;
  createClient?: (events: RegionClientEvents) => RegionClient;
  /** Where pagehide/pageshow are heard (default: window). */
  win?: EventTarget;
  /** A save made a new page version. */
  onSaved?: (version: number) => void;
  /** Open the page's first region as soon as the frame is told its regions, without a press (a doc). */
  autoOpen?: boolean;
  /** With `autoOpen`: the first open takes the focus (default). False when the page opened to show a comment. */
  autoFocus?: boolean;
  /** Moves the page's focus into the frame (the first auto-open), so keys reach the editor there. */
  focusFrame?: () => void;
  /** The toolbar's state while this person has a region editor, else null. */
  onToolbar?: (state: RegionToolbarState | null) => void;
  /** `/` at an empty block's start, in the frame's viewport; null when the menu no longer applies. */
  onSlash?: (slash: { regionId: string; x: number; y: number } | null) => void;
  /** Mod-K in the editor: the link dialog, with the link at the caret. */
  onLink?: (request: { regionId: string; href: string | null }) => void;
}

export interface RegionEditing {
  /** The frame's controller runs (again): sessions of an earlier document end, and it is told its regions. */
  attached(): void;
  membership(): RegionMembership;
  /** Saves every unsaved region edit (this page's pending ones first) as a page version, and returns it. */
  save(): Promise<number>;
  /** A toolbar or menu command for this person's editor (region-editor commandOf); false when there is none. */
  command(name: string, args?: Record<string, unknown>): boolean;
  dispose(): void;
}

const EMPTY: PageRegions = { regions: [], inside: new Set(), known: new Set() };
/** A page with no regions (or not read yet): nothing is inside one, so no comment waits for a save. */
const NO_REGIONS: RegionMembership = { inside: new Set(), known: { has: () => true } as unknown as ReadonlySet<string> };

export function startRegionEditing(options: RegionEditingOptions): RegionEditing {
  const { bridge } = options;
  const win = options.win ?? window;
  let page = EMPTY;
  let disposed = false;
  let loaded = false;
  let attached = false;
  /** The first auto-open (the one that takes the focus) happened. */
  let autoOpened = false;
  /** Regions with a session (or one being opened) for the current document. */
  const open = new Set<string>();
  const kinds = () => new Map(page.regions.map((region) => [region.id, region.kind]));
  let active: RegionToolbarState | null = null;
  /** The editor the chrome follows is gone (its session ended, or the document did): the chrome goes too. */
  const inactive = (regionId?: string) => {
    if (!active || (regionId !== undefined && active.regionId !== regionId)) return;
    active = null;
    options.onSlash?.(null);
    options.onToolbar?.(null);
  };

  const events: RegionClientEvents = {
    remote: (regionId, updates, seq) => { if (open.has(regionId)) bridge.sendRegion({ kind: 'region-remote', regionId, updates, seq }); },
    ack: (regionId, seq) => { if (open.has(regionId)) bridge.sendRegion({ kind: 'region-ack', regionId, seq }); },
    closed: (regionId, reason) => { if (!open.delete(regionId)) return; inactive(regionId); bridge.sendRegion({ kind: 'region-closed', regionId, reason }); },
    saved: (version) => { options.onSaved?.(version); void read(); },
  };
  const client = (options.createClient ?? ((next: RegionClientEvents) => createRegionClient(options.id, next)))(events);

  const enable = () => {
    if (!attached || !loaded || !page.regions.length || disposed) return;
    bridge.sendRegion({ kind: 'regions-enabled', regionIds: page.regions.map((region) => region.id) });
    if (!options.autoOpen) return;
    const first = page.regions.find((region) => region.kind === 'rich') ?? page.regions[0]!;
    void openRegion(first.id, !autoOpened && options.autoFocus !== false);
    autoOpened = true;
  };
  const read = async () => {
    const html = await options.loadHtml().catch(() => null);
    if (disposed || html === null) return;
    const first = !loaded;
    page = regionMembership(html);
    loaded = true;
    if (first) { if (page.regions.length) listen(); enable(); }
  };

  const openRegion = async (regionId: string, focus = false) => {
    const kind = kinds().get(regionId);
    if (!kind || open.has(regionId)) return;
    open.add(regionId);
    // The focus goes into the frame now, before the session: the frame holds the keys typed from here until its editor
    // mounts, and gives the editor the command then (frame-regions).
    if (focus) { options.focusFrame?.(); bridge.sendRegion({ kind: 'region-command', regionId, name: 'focus' }); }
    const session = await client.open(regionId);
    if (disposed) return;
    // The document that asked is gone (a new one attached meanwhile): the session it would have used ends.
    if (!open.has(regionId)) { if (session) client.close(regionId); return; }
    if (!session) { open.delete(regionId); inactive(regionId); bridge.sendRegion({ kind: 'region-closed', regionId, reason: 'refused' }); return; }
    bridge.sendRegion({ kind: 'region-session', regionId, regionKind: session.kind, clientId: session.clientId, state: session.state, seq: session.seq });
  };
  let stop = () => {};
  const listen = () => {
    stop = bridge.subscribeRegion((message) => {
      if (disposed) return;
      if (message.kind === 'region-open') void openRegion(message.regionId);
      else if (message.kind === 'region-update' && open.has(message.regionId)) client.push(message.regionId, message.update);
      else if (message.kind === 'region-caret' && open.has(message.regionId)) {
        const kind = kinds().get(message.regionId)!;
        active = { regionId: message.regionId, kind, marks: message.marks, block: message.block };
        options.onToolbar?.(active);
      } else if (message.kind === 'region-slash' && open.has(message.regionId)) options.onSlash?.({ regionId: message.regionId, x: message.x, y: message.y });
      else if (message.kind === 'region-link' && open.has(message.regionId)) options.onLink?.({ regionId: message.regionId, href: message.href });
    });
  };

  const leave = () => client.leave();
  const back = (event: Event) => { if ((event as PageTransitionEvent).persisted) client.resume(); };
  win.addEventListener('pagehide', leave);
  win.addEventListener('pageshow', back);
  void read();

  return {
    attached() {
      if (disposed) return;
      for (const regionId of [...open]) { open.delete(regionId); client.close(regionId); }
      inactive();
      attached = true;
      enable();
    },
    membership: () => page.regions.length ? page : NO_REGIONS,
    save: () => client.flush(),
    command(name, args) {
      if (!active || disposed || !open.has(active.regionId)) return false;
      bridge.sendRegion({ kind: 'region-command', regionId: active.regionId, name, ...(args ? { args } : {}) });
      return true;
    },
    dispose() {
      if (disposed) return;
      inactive();
      disposed = true;
      stop();
      open.clear();
      win.removeEventListener('pagehide', leave);
      win.removeEventListener('pageshow', back);
      client.dispose();
    },
  };
}
