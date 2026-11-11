/** Engine-neutral frame editor contract; the interactive implementation is native only. */
import type { EditorView } from 'prosemirror-view';
import type { RegionFrameMessage, RegionKind } from '@artifactbin/contracts';
import type { RegionCaretPaint } from '../html-bridge/region-carets';
export const REGION_BATCH_MS = 50;
export const REGION_EDITOR_ATTR = 'data-af-region-editor';

export interface RegionEditorOptions {
  win: Window;
  /** The region's element (`data-af-editable`), edited in place. */
  root: HTMLElement;
  regionId: string;
  kind: RegionKind;
  /** The server-assigned Yjs client id this session writes with. */
  clientId: number;
  /** The server's full merged state. */
  state: Uint8Array;
  post: (message: RegionFrameMessage) => void;
  /**
   * The person asked for this region: the editor takes the focus, its caret where they pressed (frame viewport) or at
   * the start (null). Absent when the parent opened the session itself: the focus stays where it is.
   */
  at?: { x: number; y: number } | null;
  /** With `at`: place the caret there but leave the focus where it is (the person moved on while the editor loaded). */
  focus?: false;
  /**
   * The caret this region's editor had in the document this one replaced (a version that could not be drawn in place
   * rebuilt the frame, frame-regions): put back where it was, as shared-text positions, with the focus.
   */
  caret?: { anchor: string; head: string };
}

/**
 * A key typed before the editor mounted (frame-regions' buffer): text as the input produced it (`composed` when an IME
 * committed it, inserted whole), or a key the editor acts on (Enter, Backspace, Delete, Tab, Mod-B/I/E).
 */
export type RegionKeyEntry =
  | { text: string; composed?: true }
  | { key: string; code?: string; keyCode?: number; shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };

export interface RegionEditor {
  /** The ProseMirror view on the region (tests; a later toolbar reads its state). */
  readonly view: EditorView;
  /** A repeat session for this region (the parent reconnected or the stream reset): merged in place. */
  session(clientId: number, state: Uint8Array): void;
  remote(updates: readonly Uint8Array[]): void;
  /** A native editor toolbar or menu command; false when it does not apply here. */
  command(name: string, args?: Record<string, unknown>): boolean;
  /** Keys typed before the editor mounted, applied in order at the caret as if typed now. */
  replay(entries: readonly RegionKeyEntry[]): void;
  paint(carets: readonly RegionCaretPaint[]): void;
  /** The caret overlay, which page observers ignore. */
  owns(node: Node): boolean;
  /** Sends what is gathered now (unless a composition is open). */
  flush(): void;
  /** The caret as shared-text positions, while this editor has the focus; else null. */
  caret(): { anchor: string; head: string } | null;
  destroy(): void;
}
