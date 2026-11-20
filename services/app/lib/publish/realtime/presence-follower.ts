/**
 * WHO ELSE IS ON THE PAGE, for one live stream (./document-events): the presence room of the page's current source
 * revision (lib/html-presence), its roster frames written in order with the latest winning while one is in flight.
 *
 * Interface: `follow(row)` moves to the room of this version (a new source revision replaces only the room, never
 * the stream); `documentSent()` opens the gate (the document frame always opens the stream, so a room's immediate
 * first roster waits for it); `dispose()` leaves the room. A signed-out reader gets no presence: other readers'
 * cursors, selections and handles go only to signed-in readers (a guest still shares its own,
 * app/api/artifacts/[id]/presence).
 */
import { createPresenceRoom, presenceAccountIdentity, presenceChannel, PRESENCE_EVENT, type PresenceFrame } from '@/lib/html-presence';
import { canReadArtifact, getArtifactAccessById, type ArtifactRow } from '@/lib/artifacts';
import type { AccessActor } from '@/lib/accounts';
import { registerTestOverride } from '@/lib/platform';
import { subscribeChannel, subscribeToArtifact } from './live';
import type { SseChannel } from './sse-channel';

/**
 * A test's presence frame interval (`overridePresenceFrameInterval`): the room's one-second interval made every wait for
 * a reader's next frame in services/app/__tests__/html-presence.test.ts a second (7.6s of its 7.6s). Cleared with the
 * test overrides at the end of each file.
 */
let presenceFrameIntervalMs: number | undefined;
export function overridePresenceFrameInterval(ms: number | undefined): void { presenceFrameIntervalMs = ms; }
registerTestOverride(() => { presenceFrameIntervalMs = undefined; });

export interface PresenceFollower {
  follow(row: ArtifactRow): Promise<void>;
  documentSent(): void;
  dispose(): void;
}

export function presenceFollower(options: {
  id: string;
  actor: AccessActor;
  channel: Pick<SseChannel, 'send'>;
  /** The room ended (access went, or its listener did), or a frame could not be written: the stream ends. */
  close(): void;
}): PresenceFollower {
  const { id, actor, channel } = options;
  let room: Awaited<ReturnType<typeof createPresenceRoom>> | undefined;
  let disposed = false, gateOpen = false, writing = false, latest: PresenceFrame | null = null;
  let revision: string | undefined, replacing = false;
  const write = () => {
    if (disposed || !gateOpen || writing || !latest) return;
    const frame = latest; latest = null; writing = true;
    void channel.send(JSON.stringify(frame), { event: PRESENCE_EVENT })
      .then(ok => { if (!ok) options.close(); })
      .finally(() => { writing = false; write(); });
  };
  return {
    async follow(row) {
      if (!actor.userId) return;
      if (disposed || row.format !== 'html' || revision === String(row.version)) return;
      // A new source revision replaces only its presence room, never the document stream.
      replacing = true; room?.dispose(); replacing = false;
      latest = null; revision = String(row.version);
      const next = await createPresenceRoom({
        revision: String(row.version), readerIdentity: presenceAccountIdentity(actor.userId),
        authorize: async () => { const current = await getArtifactAccessById(id); return !!current && await canReadArtifact(current, actor); },
        subscribe: (receive, lost) => subscribeChannel(presenceChannel(id), receive, lost),
        subscribeAcl: (changed, lost) => subscribeToArtifact(id, changed, lost),
        send: frame => { latest = frame; write(); }, close: () => { if (!replacing) options.close(); }, frameIntervalMs: presenceFrameIntervalMs,
        clock: { now: Date.now, setTimeout: (work, ms) => setTimeout(work, ms), clearTimeout: timer => clearTimeout(timer as ReturnType<typeof setTimeout>), setInterval: (work, ms) => setInterval(work, ms), clearInterval: timer => clearInterval(timer as ReturnType<typeof setInterval>) },
      });
      room = next; if (disposed) next.dispose();
    },
    documentSent() { if (!gateOpen) { gateOpen = true; write(); } },
    dispose() { disposed = true; room?.dispose(); latest = null; },
  };
}
