/** Migration admission and lifetime ownership, not a JavaScript security sandbox. */
export type AuthorModuleMode = "components" | "effects";
export type AuthorListener = EventListenerOrEventListenerObject;
export interface AuthorLifetimeClock {
  timeout(callback: () => void, delay: number): number;
  interval(callback: () => void, delay: number): number;
  frame(callback: (time: number) => void): number;
  clearTimeout(id: number): void;
  clearInterval(id: number): void;
  cancelFrame(id: number): void;
}
export interface AuthorEffectLifetime {
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
  timeout(
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ): number;
  interval(
    callback: (...args: unknown[]) => void,
    delay?: number,
    ...args: unknown[]
  ): number;
  frame(callback: (time: number) => void): number;
  clearTimer(id: number): void;
  cancelFrame(id: number): void;
  /** Register before invoking authored code; failed initializers are drained too. */
  own(dispose: () => void): void;
  dispose(): void;
}
