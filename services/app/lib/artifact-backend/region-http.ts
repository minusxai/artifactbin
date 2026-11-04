/**
 * THE PARENT'S REGION CLIENT: the trusted page's half of live co-editing (contract: @artifactbin/contracts
 * region-sessions). The page frame's editor only exchanges bytes with the page (frame-bridge/parent); this module
 * holds the session and makes every request, on the page's own origin with its own session cookie.
 *
 *  - `open` asks for a region's session (its server-assigned client id, seq and full state) and adds the region to the
 *    page's ONE region stream (`GET …/regions/stream?after=<regionId>:<seq>,…`, recomputed at each reopen; reconnect,
 *    backoff and heartbeat watchdog are lib/http/live-stream's).
 *  - `push` queues one local update. Updates pushed within REGION_BATCH_MS go as one merged request; a region has at
 *    most one request in flight, and what arrives meanwhile goes as one request after its reply. A failed request is
 *    retried with the live-stream backoff, and at once when the stream reconnects (updates are idempotent).
 *  - Every local update stays in a merged per-region log, so `out_of_order` (the server lacks structs this client
 *    wrote) and `reset` (the server's state moved past this client's cursor) are answered by sending exactly what the
 *    server's state vector lacks.
 *  - A hard refusal (unsupported content, foreign client, too large, region gone) or a `closed` frame ends the
 *    region's session: the frame restores the saved text.
 *  - `flush` sends every pending edit, waits for their acks, and saves them as one page version.
 *  - `leave` (pagehide) sends pending edits with `keepalive` and closes the stream, so the server's last-editor save
 *    runs; `resume` (pageshow from the back-forward cache) reopens it.
 *
 * Yjs is used without a document (merge and diff of updates only): this module loads lazily, for editors only.
 */
import * as Y from 'yjs';
import type { RegionFlushReply, RegionKind, RegionOpenReply, RegionRefusalBody, RegionStreamFrame, RegionUpdateReply } from '@artifactbin/contracts';
import { REGION_UPDATE_MAX_BYTES } from '@artifactbin/contracts';
import { liveBackoffDelay, openLiveStream, type LiveStream, type LiveStreamOptions } from '@/lib/http/live-stream';

/** Local updates within this window go as one request. */
export const REGION_BATCH_MS = 50;
/** How long `flush` waits for pending edits to be acknowledged before it gives up. */
const FLUSH_DRAIN_MS = 15_000;

export interface RegionSession { regionId: string; kind: RegionKind; clientId: number; seq: number; state: Uint8Array; savedVersion: number }

export interface RegionClientEvents {
  /** Updates other writers made (and possibly this client's own, which Yjs ignores), in order, up to `seq`. */
  remote(regionId: string, updates: Uint8Array[], seq: number): void;
  /** The server stored this client's updates up to `seq`. */
  ack(regionId: string, seq: number): void;
  /** The region's session ended: a refusal code or the server's `closed` reason. */
  closed(regionId: string, reason: string): void;
  /** Unsaved edits were saved as page version `version`. */
  saved(version: number, regions: Record<string, number>): void;
}

export interface RegionClientPorts {
  /** Same-origin request with the page's session (default: `fetch` with `credentials: 'same-origin'`). */
  fetch?: (path: string, init: RequestInit) => Promise<Response>;
  openStream?: (options: LiveStreamOptions) => LiveStream;
  random?: () => number;
}

export interface RegionClient {
  /** The region's session, or null when the server refuses it (not an editor, no such region). */
  open(regionId: string): Promise<RegionSession | null>;
  push(regionId: string, update: Uint8Array): void;
  /** End one region's session from this side (the frame closed its editor). */
  close(regionId: string): void;
  /** Saves every unsaved edit as a page version and returns it; pending local edits are sent first. */
  flush(): Promise<number>;
  leave(): void;
  resume(): void;
  dispose(): void;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const isEmptyUpdate = (update: Uint8Array): boolean => {
  const { structs, ds } = Y.decodeUpdate(update);
  return structs.length === 0 && ds.clients.size === 0;
};

/** A refusal that ends the session: anything but a transient failure or `out_of_order`. */
const HARD_REFUSALS = new Set([400, 401, 403, 404, 410, 413, 422]);

interface Region {
  regionId: string;
  clientId: number;
  /** The last server seq this client has relayed to the frame. */
  seq: number;
  /** Local updates not yet sent. */
  queue: Uint8Array[];
  /** The request in flight (or waiting to be retried). */
  inflight: Uint8Array | null;
  sending: boolean;
  /** Every local update of this session, merged: the source of what the server lacks. */
  log: Uint8Array | null;
  batch?: ReturnType<typeof setTimeout>;
  retry?: ReturnType<typeof setTimeout>;
  attempt: number;
  closed: boolean;
}

export function createRegionClient(id: string, events: RegionClientEvents, ports: RegionClientPorts = {}): RegionClient {
  const send = ports.fetch ?? ((path: string, init: RequestInit) => fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' }));
  const request = (path: string, init: RequestInit) => send(path, { credentials: 'same-origin', ...init });
  const openStream = ports.openStream ?? openLiveStream;
  const base = `/api/artifacts/${encodeURIComponent(id)}/regions`;
  const regions = new Map<string, Region>();
  const idle = new Set<() => void>();
  let stream: LiveStream | null = null;
  let disposed = false;
  let away = false;

  const settled = (region: Region) => region.closed || (!region.inflight && !region.queue.length);
  const notifyIdle = () => { if ([...regions.values()].every(settled)) for (const done of [...idle]) done(); };

  const end = (region: Region, reason: string) => {
    if (region.closed) return;
    region.closed = true;
    clearTimeout(region.batch);
    clearTimeout(region.retry);
    region.queue = [];
    region.inflight = null;
    regions.delete(region.regionId);
    events.closed(region.regionId, reason);
    notifyIdle();
    if (!regions.size) closeStream();
  };

  const post = async (region: Region, keepalive = false) => {
    if (region.closed || region.sending || disposed) return;
    clearTimeout(region.batch);
    region.batch = undefined;
    if (!region.inflight) {
      if (!region.queue.length) { notifyIdle(); return; }
      region.inflight = region.queue.length === 1 ? region.queue[0]! : Y.mergeUpdates(region.queue);
      region.queue = [];
    }
    clearTimeout(region.retry);
    region.retry = undefined;
    const update = region.inflight;
    if (update.byteLength > REGION_UPDATE_MAX_BYTES) { end(region, 'too_large'); return; }
    region.sending = true;
    let response: Response | null = null;
    try {
      response = await request(`${base}/${encodeURIComponent(region.regionId)}/updates`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive,
        body: JSON.stringify({ clientId: region.clientId, update: encodeBase64(update) }),
      });
    } catch { response = null; }
    region.sending = false;
    if (region.closed || disposed) return;
    if (response?.ok) {
      const reply = await response.json().catch(() => null) as RegionUpdateReply | null;
      region.inflight = null;
      region.attempt = 0;
      if (reply && Number.isSafeInteger(reply.seq)) events.ack(region.regionId, reply.seq);
      if (region.queue.length) void post(region); else notifyIdle();
      return;
    }
    const refusal = response ? await response.json().catch(() => null) as RegionRefusalBody | null : null;
    if (response?.status === 409 && refusal?.error === 'out_of_order' && typeof refusal.stateVector === 'string' && region.log) {
      // Everything this client wrote that the server lacks, including what is still queued.
      let missing: Uint8Array;
      try { missing = Y.diffUpdate(region.log, decodeBase64(refusal.stateVector)); } catch { end(region, 'out_of_order'); return; }
      region.queue = [];
      region.inflight = isEmptyUpdate(missing) ? null : missing;
      if (region.attempt++ > 0) { schedule(region); return; }
      void post(region);
      return;
    }
    if (response && (HARD_REFUSALS.has(response.status) || response.status === 409)) { end(region, refusal?.error ?? `status_${response.status}`); return; }
    schedule(region);
  };
  /** Retry after the live-stream backoff (a network failure or a 5xx). */
  const schedule = (region: Region) => {
    clearTimeout(region.retry);
    region.retry = setTimeout(() => { region.retry = undefined; void post(region); }, liveBackoffDelay(region.attempt++, ports.random));
  };

  const after = () => [...regions.values()].map((region) => `${region.regionId}:${region.seq}`).join(',');
  const onFrame = (data: string) => {
    let frame: RegionStreamFrame;
    try { frame = JSON.parse(data) as RegionStreamFrame; } catch { return; }
    if (!frame || typeof frame !== 'object') return;
    if (frame.type === 'saved') {
      if (Number.isSafeInteger(frame.version)) events.saved(frame.version, frame.regions && typeof frame.regions === 'object' ? frame.regions : {});
      return;
    }
    const region = typeof frame.regionId === 'string' ? regions.get(frame.regionId) : undefined;
    if (!region) return;
    if (frame.type === 'closed') { end(region, typeof frame.reason === 'string' ? frame.reason : 'closed'); return; }
    if (frame.type === 'updates') {
      if (!Array.isArray(frame.updates) || !Number.isSafeInteger(frame.from) || !Number.isSafeInteger(frame.to) || frame.to - frame.from + 1 !== frame.updates.length) return;
      if (frame.to <= region.seq) return;
      // A frame after a gap: the stream starts again after what was relayed, and the server catches it up.
      if (frame.from > region.seq + 1) { reopen(); return; }
      let updates: Uint8Array[];
      try { updates = frame.updates.slice(region.seq + 1 - frame.from).map(decodeBase64); } catch { return; }
      region.seq = frame.to;
      events.remote(region.regionId, updates, frame.to);
      return;
    }
    if (frame.type === 'reset') {
      if (typeof frame.state !== 'string' || !Number.isSafeInteger(frame.seq)) return;
      let state: Uint8Array;
      try { state = decodeBase64(frame.state); } catch { return; }
      region.seq = frame.seq;
      events.remote(region.regionId, [state], frame.seq);
      // What this client wrote that the new state does not hold goes again (with what is queued, merged).
      if (region.log) {
        let missing: Uint8Array | null = null;
        try { missing = Y.diffUpdate(region.log, Y.encodeStateVectorFromUpdate(state)); } catch { missing = null; }
        if (missing && !isEmptyUpdate(missing) && !region.inflight) { region.queue = [missing]; void post(region); }
        else if (missing && !isEmptyUpdate(missing)) region.queue.push(missing);
      }
    }
  };
  /** Every request waiting out a backoff goes now: the stream answers again. */
  const reconnected = () => { for (const region of regions.values()) if (region.retry !== undefined) void post(region); };
  const openTheStream = () => {
    if (stream || disposed || away || !regions.size) return;
    stream = openStream({ url: () => `${base}/stream?after=${after()}`, onMessage: onFrame, onReconnect: reconnected });
  };
  const closeStream = () => { stream?.close(); stream = null; };
  const reopen = () => { closeStream(); openTheStream(); };

  return {
    async open(regionId) {
      if (disposed) return null;
      let response: Response;
      try { response = await request(`${base}/${encodeURIComponent(regionId)}/open`, { method: 'POST' }); } catch { return null; }
      if (!response.ok || disposed) return null;
      const reply = await response.json().catch(() => null) as RegionOpenReply | null;
      if (!reply || reply.regionId !== regionId || (reply.kind !== 'rich' && reply.kind !== 'text') || !Number.isSafeInteger(reply.clientId) || !Number.isSafeInteger(reply.seq) || typeof reply.state !== 'string' || !Number.isSafeInteger(reply.savedVersion)) return null;
      let state: Uint8Array;
      try { state = decodeBase64(reply.state); } catch { return null; }
      const previous = regions.get(regionId);
      if (previous) { clearTimeout(previous.batch); clearTimeout(previous.retry); previous.closed = true; }
      regions.set(regionId, { regionId, clientId: reply.clientId, seq: reply.seq, queue: [], inflight: null, sending: false, log: null, attempt: 0, closed: false });
      // The stream follows every open region from its own seq.
      reopen();
      return { regionId, kind: reply.kind, clientId: reply.clientId, seq: reply.seq, state, savedVersion: reply.savedVersion };
    },
    push(regionId, update) {
      const region = regions.get(regionId);
      if (!region || region.closed || !(update instanceof Uint8Array) || !update.byteLength) return;
      region.queue.push(update);
      region.log = region.log ? Y.mergeUpdates([region.log, update]) : update;
      if (region.batch === undefined && !region.inflight) region.batch = setTimeout(() => { region.batch = undefined; void post(region); }, REGION_BATCH_MS);
    },
    close(regionId) {
      const region = regions.get(regionId);
      if (!region) return;
      // What it wrote still goes; the session ends once it is acknowledged.
      if (settled(region)) { region.closed = true; regions.delete(regionId); if (!regions.size) closeStream(); }
      else void post(region);
    },
    async flush() {
      for (const region of regions.values()) if (region.batch !== undefined || (region.inflight && region.retry !== undefined)) void post(region);
      if (![...regions.values()].every(settled)) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => { idle.delete(done); reject(new Error('Your latest edits could not be saved. Try again.')); }, FLUSH_DRAIN_MS);
          const done = () => { clearTimeout(timer); idle.delete(done); resolve(); };
          idle.add(done);
          notifyIdle();
        });
      }
      const response = await request(`${base}/flush`, { method: 'POST' });
      const reply = response.ok ? await response.json().catch(() => null) as RegionFlushReply | null : null;
      if (!reply || !Number.isSafeInteger(reply.version)) throw new Error(`Could not save the page before commenting (${response.status})`);
      return reply.version;
    },
    leave() {
      away = true;
      for (const region of regions.values()) if (!region.sending && (region.queue.length || region.inflight)) void post(region, true);
      closeStream();
    },
    resume() {
      if (!away) return;
      away = false;
      openTheStream();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const region of regions.values()) { clearTimeout(region.batch); clearTimeout(region.retry); region.closed = true; }
      regions.clear();
      closeStream();
      for (const done of [...idle]) done();
    },
  };
}
