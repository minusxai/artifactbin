/**
 * THE FRAME'S PORT FOR LIVE DATASET TEXT CELLS (contracts region-sessions CellScope), in the page reader: what the
 * page library `@afbin/collab` talks through. Small on purpose (no Yjs): it carries bytes between a bound cell and the
 * frame bridge, under the cell's key, with the region messages (`region-open`/`region-update` out; `region-session`,
 * `region-remote`, `region-ack`, `region-closed` in).
 *
 *  - A cell connects once; whenever a bridge session attaches (the page's connection) its `region-open` is sent, so a
 *    frame that reconnects (a new controller) opens it again and the cell gets a new `session`.
 *  - A page that cannot write cells (no app parent: a portable copy, a page opened outside the app) answers every
 *    connect with `closed` `readonly` at once.
 */
import { CELL_READONLY, isCellKey, type RegionFrameMessage, type RegionParentMessage } from '@artifactbin/contracts';

export interface CellPeer {
  /** A session opened: the client id to write under, the merged state and its sequence. */
  session(clientId: number, state: Uint8Array, seq: number): void;
  remote(updates: Uint8Array[]): void;
  /** The server stored updates; `settled`: everything the first `settled` updates of this session held is stored. */
  ack(settled: number | null): void;
  /** The session ended (a refusal, `readonly`, `removed`, `access`). */
  closed(reason: string): void;
  /** The page connection came (a session will follow) or went. */
  connected(on: boolean): void;
}
export interface CellLink { update(update: Uint8Array): void; close(): void }
export interface CellPort { connect(key: string, peer: CellPeer): CellLink }

type Post = (message: RegionFrameMessage) => void;
export interface FrameCells {
  /** Takes a parent payload; true when it was a cell's message. */
  receive(payload: { kind: string; regionId?: unknown }): boolean;
  dispose(): void;
}

export function createCellPort(options: { writable: boolean }): { port: CellPort; attach(post: Post): FrameCells } {
  const peers = new Map<string, CellPeer>();
  let post: Post | null = null;
  const port: CellPort = {
    connect(key, peer) {
      if (!isCellKey(key) || peers.has(key)) throw new Error(`@afbin/collab: ${key} is not a cell, or is bound twice`);
      if (!options.writable) { queueMicrotask(() => peer.closed(CELL_READONLY)); return { update() {}, close() {} }; }
      peers.set(key, peer);
      if (post) { peer.connected(true); post({ kind: 'region-open', regionId: key }); }
      return {
        update(update) { if (peers.get(key) === peer && post) post({ kind: 'region-update', regionId: key, update }); },
        close() { if (peers.get(key) === peer) peers.delete(key); },
      };
    },
  };
  return {
    port,
    attach(next) {
      post = next;
      const attached = next;
      for (const [key, peer] of peers) { peer.connected(true); next({ kind: 'region-open', regionId: key }); }
      return {
        receive(payload) {
          if (!payload.kind.startsWith('region-') || !isCellKey(payload.regionId)) return false;
          const message = payload as RegionParentMessage & { regionId: string };
          const peer = peers.get(message.regionId);
          if (!peer || post !== attached) return true;
          switch (message.kind) {
            case 'region-session':
              if (Number.isInteger(message.clientId) && message.state instanceof Uint8Array) peer.session(message.clientId, message.state, message.seq);
              return true;
            case 'region-remote':
              if (Array.isArray(message.updates) && message.updates.every((update) => update instanceof Uint8Array)) peer.remote(message.updates);
              return true;
            case 'region-ack': peer.ack(Number.isSafeInteger(message.settled) ? message.settled! : null); return true;
            case 'region-closed': peer.closed(typeof message.reason === 'string' ? message.reason : 'closed'); return true;
            default: return true;
          }
        },
        dispose() {
          if (post !== attached) return;
          post = null;
          for (const peer of peers.values()) peer.connected(false);
        },
      };
    },
  };
}
