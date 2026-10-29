/** Ephemeral reader geometry. Never contains selected text, account credentials or page state. */
export interface PresenceCursor { nodeId: string; x: number; y: number }
export interface PresenceRange { nodeId: string; start: number; end: number; length: number; fingerprint: string }
export interface PresenceGeometry { cursor: PresenceCursor | null; selection: PresenceRange[] | null }
export interface ReaderPreferences { visible: boolean; shareCursor: boolean; shareSelection: boolean; showCursors: boolean; showSelections: boolean }
export const readerDefaults: ReaderPreferences = { visible: true, shareCursor: true, shareSelection: true, showCursors: true, showSelections: true };
export interface PresenceViewer extends PresenceGeometry { id: string; label: string; revision: string; seen: number }
export interface PresencePublication extends PresenceGeometry { session: string; revision: string; visible: boolean }
/** One roster frame: at most PRESENCE_ROSTER_CAP viewers, and how many live readers the room holds in all (this tab included while it is visible). */
export interface PresenceFrame { viewers: PresenceViewer[]; total: number }
export interface PresencePaint { viewers: PresenceViewer[]; preferences: ReaderPreferences }

/** Named frame on the document's existing live stream. */
export const PRESENCE_EVENT = 'presence';
