import type { PresenceCursor, PresenceGeometry, PresenceRange, PresenceViewer } from './contract';
/** A reader announces itself every heartbeat; it stays on the roster for three, so two lost beats never drop it. */
export const PRESENCE_HEARTBEAT_MS = 15_000;
export const PRESENCE_TTL_MS = 45_000;
/** Pointer and selection changes are coalesced to one publication per window; the painter interpolates between them. */
export const PRESENCE_POINTER_THROTTLE_MS = 250;
/** A room re-authorizes at once on an ACL wakeup; this interval is only the safety net for a missed one. */
export const PRESENCE_REAUTHORIZE_MS = 60_000;
const nodeId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256;
/** Pagegi presence semantics: normalized node-relative cursors, exact fingerprinted text offsets and a short TTL. */
export function presenceGeometry(input: unknown): PresenceGeometry {
  const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  let cursor: PresenceCursor | null = null;
  const c = raw.cursor as PresenceCursor | null;
  if (c && nodeId(c.nodeId) && Number.isFinite(c.x) && Number.isFinite(c.y) && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1) cursor = {nodeId:c.nodeId,x:c.x,y:c.y};
  let selection: PresenceRange[] | null = null;
  if (Array.isArray(raw.selection) && raw.selection.length > 0 && raw.selection.length <= 8) {
    const ranges = raw.selection as PresenceRange[];
    if (ranges.every(r => r && nodeId(r.nodeId) && Number.isInteger(r.start) && Number.isInteger(r.end) && Number.isInteger(r.length) && r.start >= 0 && r.end > r.start && r.end <= r.length && r.length <= 100_000 && typeof r.fingerprint === 'string' && /^[a-f0-9]{8}$/.test(r.fingerprint))) selection = ranges.map(r=>({nodeId:r.nodeId,start:r.start,end:r.end,length:r.length,fingerprint:r.fingerprint}));
  }
  return { cursor, selection };
}
/** Bounded ephemeral roster; the injected clock makes expiration independent of delivery timing. */
export function presenceRoster(entries: readonly PresenceViewer[], revision: string, now: number): PresenceViewer[] {
  return entries.filter(entry => entry.revision === revision && entry.seen <= now && now - entry.seen < PRESENCE_TTL_MS).slice(-100).map(entry => ({...entry,...presenceGeometry(entry)}));
}
