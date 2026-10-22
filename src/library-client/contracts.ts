export interface LibraryProfile {
  name: string;
  image: string | null;
}
export interface LibraryFile {
  visibility?: "private" | "unlisted" | "public";
  path: string;
  fileId: string;
  title: string;
  url: string;
  commentCount: number;
  /** Optional server-generated cover image. Absence keeps a neutral HTML cover. */
  previewUrl?: string;
}
export interface LibraryData {
  username: string;
  files?: LibraryFile[];
  sharedFiles?: LibraryFile[];
  folders?: string[];
}
export type LibrarySnapshot =
  | { status: "pending" }
  | { status: "signed-in"; data: LibraryData; profile: LibraryProfile }
  | { status: "signed-out" | "failed"; error: string };
export interface LibraryTransport {
  (
    path: string,
    body: unknown,
    signal: AbortSignal,
    token: string | null,
    /** Default: POST with a body, GET without. */
    method?: string,
  ): Promise<unknown>;
}
/** Builds the library's transport: a JSON error body's `error` is kept with its status;
 * a dropped connection, a timeout or a body that is not JSON becomes one plain sentence
 * (with the status when there was a response); a caller's own abort is rethrown as is. */
export type LibraryFetcher = (
  path: string,
  init: RequestInit,
) => Promise<Response>;
export type CreateLibraryTransport = (
  fetcher: LibraryFetcher,
  timeoutMs?: number,
) => LibraryTransport;
/** What the listing shows for a folder: its rows, that it is empty, that a search
 * matched nothing, or that the folder does not exist. */
export interface LibraryListing {
  state: "rows" | "empty" | "no-results" | "missing";
  /** Paths of the folder's entries that match the search, in display order. */
  visible: string[];
}
export interface LibrarySessionOptions {
  request: LibraryTransport;
  embedded: boolean;
  sharing: boolean;
  /** The page knows no session was sent with it: the first load is signed out without asking the server. */
  signedOut?: boolean;
  changed: (snapshot: LibrarySnapshot) => void;
}
/** Owns authentication authority and request epochs. Stale completions never publish a snapshot. */
export interface LibrarySession {
  getSnapshot(): LibrarySnapshot;
  load(): Promise<LibrarySnapshot | undefined>;
  request<T = unknown>(
    path: string,
    body?: unknown,
    method?: string,
  ): Promise<T>;
  verify(email: string, code: string): Promise<boolean>;
  logout(): Promise<boolean>;
  token(): string | null;
  cancelAuthentication(): void;
  dispose(): void;
}
export interface LibraryActions {
  rename(from: string, name: string): Promise<void>;
  createFolder(name: string): Promise<void>;
  move(paths: string[], destination: string): Promise<void>;
  removeFolder(path: string): Promise<void>;
  /** The example is named by the server from its title, in the current folder. */
  createExample(): Promise<string>;
  /** Refuses, before any request, a name that is not .html/.htm, an empty file, a file over
   * MAX_PAGE_SOURCE UTF-8 bytes, and a name the server's paths refuse, each in a plain sentence. */
  publish(file: {
    name: string;
    size: number;
    text(): Promise<string>;
  }): Promise<string>;
}
export interface LibraryActionsOptions {
  folder: string;
  request<T>(path: string, body: unknown): Promise<T>;
  id(): string;
}

export type LibraryLayout = "gallery" | "list";
/** Search applies to owned and shared artifacts using the same path/title fields. */
export interface LibrarySearchEntry {
  visibility?: "private" | "unlisted" | "public";
  path: string;
  title?: string;
}
export interface LibrarySurface {
  onboarding: boolean;
  toolbar: boolean;
  noResults: boolean;
}
