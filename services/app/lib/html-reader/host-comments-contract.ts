/**
 * THE HOST MODULE ↔ ITS COMMENTS MODULE: what /af/host.js (./host-shell) hands the module it imports when a shell mounts
 * a document with `comments: true` (solid/document/browser-host-comments, built by
 * lib/html-runtime/build-portable-chrome.server), and what it gets back. Types only: neither side bundles the other.
 */
import type { FrameBridgeParent } from './frame-bridge/parent';

export type HostMode = 'light' | 'dark';

export interface HostCommentsOptions {
  win: Window;
  /** The document's id. */
  id: string;
  /** The app's compiled sheet the module's trusted roots adopt (the module's own `stylesheet` export). */
  stylesheet: string;
  /** Dispatch an event on the shell's container; answers false when a cancelable one was prevented. */
  emit(name: string, detail: unknown, cancelable?: boolean): boolean;
  /** The parent half of the document's bridge: the comments and selection actions talk to the frame through it. */
  bridge: FrameBridgeParent;
  /** The document's frame: the shell's layout may resize it (its panel opening), and the comments' marks follow it. */
  frame: HTMLIFrameElement;
  /** The frame controller's signing nonce ('' while none runs), and its changes (a reloaded frame signs anew). */
  nonce(): string;
  onNonce(listener: (nonce: string) => void): () => void;
  /** The head the frame was served: its version and edit pointer. */
  version: number;
  editId: string;
  /** The shell's light or dark, when it has said one (setMode). */
  mode: HostMode | null;
  /** Publish this reader's presence and report the others (`af-document-presence`). */
  presence: boolean;
  /** The document's stream announced a newer version, or a change to datasets it reads: the host module draws it. */
  followVersion(version: number, live: number): void;
  notifyData(datasets: string[]): void;
}

export interface HostComments {
  /** Open the comments rail: into `panel` (the shell's element; it lays the rail out) or, without one, over the page's right edge. */
  open(panel?: HTMLElement | null): void;
  close(): void;
  setMode(mode: HostMode): void;
  destroy(): void;
}

/** The comments module's exports. */
export interface HostCommentsModule {
  mountHostComments(options: HostCommentsOptions): HostComments;
  stylesheet: string;
}
