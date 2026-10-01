import type { StoryController } from './contract';

/** Explicit local document capability. No Window-like object is created. */
export type DocumentRuntimeRef = { current: StoryController | null };
interface DocumentTarget { runtimeRef: DocumentRuntimeRef }

export function sendDocument(target: DocumentTarget, message: unknown): void {
  target.runtimeRef.current?.send(message);
}

export function subscribeDocument(target: DocumentTarget, listener: (event: { data: unknown }) => void): () => void {
  return target.runtimeRef.current?.subscribe(data => listener({ data })) ?? (() => {});
}

export function documentRect(target: DocumentTarget): DOMRect | undefined {
  return target.runtimeRef.current?.getViewportRect();
}

export function documentReady(target: DocumentTarget): boolean {
  return !!target.runtimeRef.current;
}
