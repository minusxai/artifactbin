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
}

export interface RegionEditing {
  /** The frame's controller runs (again): sessions of an earlier document end, and it is told its regions. */
  attached(): void;
  membership(): RegionMembership;
  /** Saves every unsaved region edit (this page's pending ones first) as a page version, and returns it. */
  save(): Promise<number>;
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
  /** Regions with a session (or one being opened) for the current document. */
  const open = new Set<string>();
  const kinds = () => new Map(page.regions.map((region) => [region.id, region.kind]));

  const events: RegionClientEvents = {
    remote: (regionId, updates, seq) => { if (open.has(regionId)) bridge.sendRegion({ kind: 'region-remote', regionId, updates, seq }); },
    ack: (regionId, seq) => { if (open.has(regionId)) bridge.sendRegion({ kind: 'region-ack', regionId, seq }); },
    closed: (regionId, reason) => { if (!open.delete(regionId)) return; bridge.sendRegion({ kind: 'region-closed', regionId, reason }); },
    saved: (version) => { options.onSaved?.(version); void read(); },
  };
  const client = (options.createClient ?? ((next: RegionClientEvents) => createRegionClient(options.id, next)))(events);

  const enable = () => { if (attached && loaded && page.regions.length && !disposed) bridge.sendRegion({ kind: 'regions-enabled', regionIds: page.regions.map((region) => region.id) }); };
  const read = async () => {
    const html = await options.loadHtml().catch(() => null);
    if (disposed || html === null) return;
    const first = !loaded;
    page = regionMembership(html);
    loaded = true;
    if (first) { if (page.regions.length) listen(); enable(); }
  };

  const openRegion = async (regionId: string) => {
    const kind = kinds().get(regionId);
    if (!kind || open.has(regionId)) return;
    open.add(regionId);
    const session = await client.open(regionId);
    if (disposed || !open.has(regionId)) return;
    if (!session) { open.delete(regionId); bridge.sendRegion({ kind: 'region-closed', regionId, reason: 'refused' }); return; }
    bridge.sendRegion({ kind: 'region-session', regionId, regionKind: session.kind, clientId: session.clientId, state: session.state, seq: session.seq });
  };
  let stop = () => {};
  const listen = () => {
    stop = bridge.subscribeRegion((message) => {
      if (disposed) return;
      if (message.kind === 'region-open') void openRegion(message.regionId);
      else if (message.kind === 'region-update' && open.has(message.regionId)) client.push(message.regionId, message.update);
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
      attached = true;
      enable();
    },
    membership: () => page.regions.length ? page : NO_REGIONS,
    save: () => client.flush(),
    dispose() {
      if (disposed) return;
      disposed = true;
      stop();
      open.clear();
      win.removeEventListener('pagehide', leave);
      win.removeEventListener('pageshow', back);
      client.dispose();
    },
  };
}
