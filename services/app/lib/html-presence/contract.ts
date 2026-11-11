import type { RegionCaret } from '@artifactbin/contracts';
/** Ephemeral reader geometry. Never contains selected text, account credentials or page state. */
export interface PresenceCursor { nodeId: string; x: number; y: number }
export interface PresenceRange { nodeId: string; start: number; end: number; length: number; fingerprint: string }
export interface PresenceGeometry {
  cursor: PresenceCursor | null; selection: PresenceRange[] | null;
  /** An editor's caret inside an editable region (Yjs relative positions, model.ts regionCaret); absent otherwise. */
  region?: RegionCaret;
}
export interface ReaderPreferences { visible: boolean; shareCursor: boolean; shareSelection: boolean; showCursors: boolean; showSelections: boolean }
export const readerDefaults: ReaderPreferences = { visible: true, shareCursor: true, shareSelection: true, showCursors: true, showSelections: true };
export interface PresenceViewer extends PresenceGeometry { id: string; /** Opaque server-derived color identity; never a session secret or display label. */ colorId?: string; label: string; revision: string; seen: number }
export interface PresencePublication extends PresenceGeometry { session: string; revision: string; visible: boolean }
/** Bounded per-session geometry, legacy session counts, and additive personalized unique-reader statistics. */
export interface PresenceFrame {
  viewers: PresenceViewer[];
  /** Legacy session total, retained for old clients during rolling releases. */
  total: number;
  /** Personalized unique OTHER readers, computed before the geometry cap. No identity directory leaves the room. */
  readers?: { total: number; expiresAt: number };
}
/** Trusted publication response; colorId identifies the account (or just this anonymous session), even while hidden. */
export interface PresenceIdentity { id: string; colorId: string }
export interface PresencePaint { viewers: PresenceViewer[]; preferences: ReaderPreferences }

/** Named frame on the document's existing live stream. */
export const PRESENCE_EVENT = 'presence';
