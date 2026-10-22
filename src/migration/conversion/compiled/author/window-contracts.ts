import type { AuthorEffectLifetime } from "./lifecycle-contracts.ts";
export interface AuthorWindowEvent {
  readonly type: string;
  readonly timeStamp: number;
  readonly key?: string;
  readonly button?: number;
  readonly clientX?: number;
  readonly clientY?: number;
}
export interface AuthorMediaQuery extends EventTarget {
  readonly media: string;
  readonly matches: boolean;
}
/** Browser native ports stay private to the lifetime facade. */
export interface AuthorWindowPort extends EventTarget {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio: number;
  readonly scrollX: number;
  readonly scrollY: number;
  matchMedia(query: string): AuthorMediaQuery;
}
export interface AuthorWindowFacade {
  readonly innerWidth: number;
  readonly innerHeight: number;
  readonly devicePixelRatio: number;
  readonly scrollX: number;
  readonly scrollY: number;
  addEventListener(
    type: string,
    callback: (event: Readonly<AuthorWindowEvent>) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    callback: (event: Readonly<AuthorWindowEvent>) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  matchMedia(query: string): {
    readonly media: string;
    readonly matches: boolean;
    addEventListener(
      type: "change",
      callback: (
        event: Readonly<{ type: "change"; matches: boolean; media: string }>,
      ) => void,
      options?: boolean | AddEventListenerOptions,
    ): void;
    removeEventListener(
      type: "change",
      callback: (
        event: Readonly<{ type: "change"; matches: boolean; media: string }>,
      ) => void,
      options?: boolean | EventListenerOptions,
    ): void;
  };
}
export type AuthorWindowFactory = (
  port: AuthorWindowPort,
  lifetime: AuthorEffectLifetime,
) => AuthorWindowFacade;
