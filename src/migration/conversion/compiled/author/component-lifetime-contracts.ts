import type { AuthorListener } from "./lifecycle-contracts.ts";
/** Injected Solid ownership operations; no authored module is evaluated by this port. */
export interface AuthorComponentOwners<Owner extends object> {
  current(): Owner | null;
  run<T>(owner: Owner, callback: () => T): T;
  cleanup(owner: Owner, dispose: () => void): void;
}
/** Listener-only component lifetime. Timers are deliberately outside this capability. */
export interface AuthorComponentLifetime {
  readonly active: boolean;
  listen(
    target: EventTarget,
    type: string,
    listener: AuthorListener,
    options?: boolean | AddEventListenerOptions,
  ): void;
  unlisten(
    target: EventTarget,
    type: string,
    listener: AuthorListener,
    options?: boolean | EventListenerOptions,
  ): void;
  callback<T extends (...args: any[]) => any>(
    callback: T,
  ): (...args: Parameters<T>) => ReturnType<T> | undefined;
  cleanup(callback: () => void): () => void;
  dispose(): void;
}
