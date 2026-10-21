import type { Profile, SharingPreferences, Viewer } from "../contracts.ts";
import type { CommentSelection } from "./comment-panel-contracts.ts";
export type ColorMode = "light" | "dark";
/** Presentation projection: no credentials, mutable document or persistence access. */
export interface ChromeView {
  actor: string | null;
  profiles: Record<string, Profile>;
  viewers: Viewer[];
  sessionId: string;
  remote: boolean;
  connected: boolean;
  canComment: boolean;
  preferences: SharingPreferences;
}
export type ChromeAction =
  | { kind: "connect"; origin?: string }
  | {
      kind:
        | "return"
        | "account"
        | "share"
        | "add-comment"
        /** Comment on the whole page rather than one node. */
        | "page-comment"
        | "disconnect"
        | "download"
        | "library";
    }
  | { kind: "view-person"; sessionId: string }
  | { kind: "theme"; theme: ColorMode }
  /** The viewer's design system for pages; null returns to each page's own. */
  | { kind: "design-system"; designSystem: import("../af-contracts.ts").DesignSystemName | null }
  | { kind: "preference"; key: keyof SharingPreferences; value: boolean }
  | { kind: "comment-context"; selection: CommentSelection };
export interface PlatformChromeOptions {
  read(): ChromeView;
  act(action: ChromeAction): unknown;
  error(message: string): void;
  /** Starts a user interaction, before its effects or errors are delivered. */
  beginAction?(): void;
}
export interface PlatformChrome {
  readonly bar: HTMLElement;
  readonly theme: ColorMode;
  renderIdentity(): void;
  renderPeople(): void;
  /** Refresh recovery actions in an open settings menu without replacing its controls. */
  /** Show a theme; persist false re-applies it without recording a pick or telling the page. */
  setTheme(theme: ColorMode, persist?: boolean): void;
  setStatus(label: string): void;
  showApproval(url: string): void;
  showConnect(show: boolean): void;
  showReturn(show: boolean): void;
  showLibrary(show: boolean): void;
  promptConnection(): void;
  context(selection: CommentSelection, x: number, y: number): void;
  hideContext(): void;
  close(focus?: boolean): void;
  dismissOutside(target: Node): void;
  dispose(): void;
}
