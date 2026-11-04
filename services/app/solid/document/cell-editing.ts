/**
 * LIVE DATASET TEXT CELLS ON THE PAGE (contract region-sessions CellScope): the trusted page's relay for the cells the
 * framed document binds with `@afbin/collab`. An intentional lazy browser chunk (Yjs through the region client),
 * loaded by create-framed-story the first time a signed-in reader's frame asks for a cell; a signed-out reader is
 * answered `readonly` there, with no request made.
 *
 *  - `region-open` with a cell key: the cell's session is opened with the server (region-http, the same client as
 *    regions, its own stream of cells). The server decides (the page's link, the dataset rule for that row and
 *    column, the collaborative flag); a refusal is `region-closed` `readonly`.
 *  - Updates are relayed both ways, as for regions; an ack says whether everything the frame wrote is stored
 *    (`settled`), which the frame shows as `synced`.
 *  - A new document in the frame ends this document's sessions (`attached`); pagehide sends pending edits and closes
 *    the stream (the server saves what this reader typed); pageshow from the back-forward cache resumes.
 */
import { CELL_READONLY, isCellKey, type RegionFrameMessage, type RegionParentMessage } from '@artifactbin/contracts';
import { createRegionClient, type RegionClient, type RegionClientEvents } from '@/lib/artifact-backend/region-http';

interface CellBridge {
  sendRegion(message: RegionParentMessage): void;
  subscribeRegion(listener: (message: RegionFrameMessage) => void): () => void;
}

export interface CellEditingOptions {
  id: string;
  bridge: CellBridge;
  createClient?: (events: RegionClientEvents) => RegionClient;
  win?: EventTarget;
}

export interface CellEditing {
  /** A `region-open` for a cell key, from the frame. */
  open(key: string): void;
  /** The frame's controller runs (again): sessions of an earlier document end. */
  attached(): void;
  dispose(): void;
}

export function startCellEditing(options: CellEditingOptions): CellEditing {
  const { bridge } = options;
  const win = options.win ?? window;
  let disposed = false;
  /** Cells with a session (or one being opened) for the current document. */
  const open = new Set<string>();
  /** Per open cell: how many updates the frame has sent (an ack that settles reports it). */
  const received = new Map<string, number>();
  const events: RegionClientEvents = {
    remote: (key, updates, seq) => { if (open.has(key)) bridge.sendRegion({ kind: 'region-remote', regionId: key, updates, seq }); },
    ack: (key, seq, settled) => { if (open.has(key)) bridge.sendRegion({ kind: 'region-ack', regionId: key, seq, ...(settled ? { settled: received.get(key) ?? 0 } : {}) }); },
    closed: (key, reason) => { if (open.delete(key)) bridge.sendRegion({ kind: 'region-closed', regionId: key, reason }); },
    saved: () => {},
  };
  const client = (options.createClient ?? ((next: RegionClientEvents) => createRegionClient(options.id, next)))(events);

  const openCell = async (key: string) => {
    if (disposed || !isCellKey(key) || open.has(key)) return;
    open.add(key);
    const session = await client.open(key);
    if (disposed) return;
    if (!open.has(key)) { if (session) client.close(key); return; }
    if (!session) { open.delete(key); bridge.sendRegion({ kind: 'region-closed', regionId: key, reason: CELL_READONLY }); return; }
    received.set(key, 0);
    bridge.sendRegion({ kind: 'region-session', regionId: key, regionKind: session.kind, clientId: session.clientId, state: session.state, seq: session.seq });
  };
  const stop = bridge.subscribeRegion((message) => {
    if (disposed || !('regionId' in message) || !isCellKey(message.regionId)) return;
    if (message.kind === 'region-open') void openCell(message.regionId);
    else if (message.kind === 'region-update' && open.has(message.regionId)) { received.set(message.regionId, (received.get(message.regionId) ?? 0) + 1); client.push(message.regionId, message.update); }
  });
  const leave = () => client.leave();
  const back = (event: Event) => { if ((event as PageTransitionEvent).persisted) client.resume(); };
  win.addEventListener('pagehide', leave);
  win.addEventListener('pageshow', back);

  return {
    open: (key) => void openCell(key),
    attached() {
      for (const key of [...open]) { open.delete(key); client.close(key); }
    },
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
