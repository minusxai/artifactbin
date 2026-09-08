import type { InlineStoryController } from './InlineStoryRuntime';

/** Explicit local document capability. No Window-like object is created. */
export type DocumentRuntimeRef = { current: InlineStoryController | null };
export interface DocumentTarget {
  runtimeRef?: DocumentRuntimeRef;
  /** Real standalone frame compatibility, used by raw/editor fixtures. Never an author iframe. */
  frameRef?: { current: HTMLIFrameElement | null };
}

export function sendDocument(target: DocumentTarget, message: unknown): void {
  if (target.runtimeRef) target.runtimeRef.current?.send(message);
  else target.frameRef?.current?.contentWindow?.postMessage(message, '*');
}

export function subscribeDocument(target: DocumentTarget, listener: (event: { data: unknown }) => void): () => void {
  if (target.runtimeRef) return target.runtimeRef.current?.subscribe(data => listener({ data })) ?? (() => {});
  const win = target.frameRef?.current?.contentWindow;
  if (!win) return () => {};
  // Consumers validate the established session nonce as before. The identity
  // check is never optional, including while a frame is absent/replaced.
  const receive = (event: MessageEvent) => { if (event.source === win) listener(event); };
  window.addEventListener('message', receive);
  return () => window.removeEventListener('message', receive);
}

export function documentRect(target: DocumentTarget): DOMRect | undefined {
  return target.runtimeRef?.current?.getViewportRect() ?? target.frameRef?.current?.getBoundingClientRect();
}

export function documentReady(target: DocumentTarget): boolean {
  return !!(target.runtimeRef ? target.runtimeRef.current : target.frameRef?.current?.contentWindow);
}
