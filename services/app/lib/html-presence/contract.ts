/** Ephemeral reader geometry. Never contains selected text, account credentials or page state. */
export interface PresenceCursor { nodeId: string; x: number; y: number }
export interface PresenceRange { nodeId: string; start: number; end: number; length: number; fingerprint: string }
export interface PresenceGeometry { cursor: PresenceCursor | null; selection: PresenceRange[] | null }
export interface ReaderPreferences { visible: boolean; shareCursor: boolean; shareSelection: boolean; showCursors: boolean; showSelections: boolean }
export const readerDefaults: ReaderPreferences = { visible: true, shareCursor: true, shareSelection: true, showCursors: true, showSelections: true };
export interface PresenceViewer extends PresenceGeometry { id: string; label: string; revision: string; seen: number }
export interface PresencePublication extends PresenceGeometry { session: string; revision: string; visible: boolean }
export interface PresencePaint { viewers: PresenceViewer[]; preferences: ReaderPreferences }
