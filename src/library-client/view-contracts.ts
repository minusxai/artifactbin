import type {
  LibraryData,
  LibraryFile,
  LibraryProfile,
  LibrarySession,
} from "./contracts.ts";
export type ElementById = (id: string) => HTMLElement;
export type FrameEvent = (event: "ready" | "close" | "profile-changed") => void;
interface SessionViewOptions {
  $: ElementById;
  request: LibrarySession["request"];
  load(): Promise<void>;
  frameEvent: FrameEvent;
}
export interface LoginViewOptions extends SessionViewOptions {
  session: Pick<LibrarySession, "verify" | "cancelAuthentication">;
}
export interface AccountViewOptions extends SessionViewOptions {
  embedded: boolean;
  parentOrigin: string;
}
export interface AccountView {
  close(focus?: boolean): void;
  update(profile: LibraryProfile, username: string): void;
}
export interface FilesViewOptions {
  $: ElementById;
  request: LibrarySession["request"];
  reload(): Promise<void>;
  message(value: string): void;
  openSharing(origin: string, id: string): void;
  folder: string;
}
export interface FilesView {
  update(data: LibraryData): void;
  renderDiscovered(container: HTMLElement, entries: LibraryFile[]): void;
}
/** Navigation presentation follows the resolved session screen, never a pending account. */
export interface WorkspaceNavigation {
  visible: boolean;
  active: "artifacts" | "account";
}
