/** Public bridge data. Collaboration credentials are deliberately absent. */
export interface PlatformPublication {
  fileId: string;
  share: string;
  sourceRevision: string;
}
export interface PlatformBinding {
  fileId?: string;
  /** The link's read capability. A downloaded file has none: the frame takes it from the page it opens. */
  share?: string;
  sourceRevision: string;
  /** The server's number for the open version, when known (a downloaded file's meta block). */
  version?: number;
  sessionId: string;
  source?: string;
  requestId?: string;
  sources?: Record<string, string>;
}
export type PlatformOperation =
  | { kind: "permissions" }
  | { kind: "comments.list" }
  | { kind: "comments.create"; comment: unknown; snapshot: unknown }
  /** Resolve a thread, or reopen it with resolved: false. */
  | { kind: "comments.resolve"; id: string; revision: number; resolved?: boolean }
  | { kind: "context.get"; id: string }
  | { kind: "profiles.list" }
  | { kind: "presence.capture"; sessionId: string };
export type PlatformLiveEvent =
  | { type: "live-ready" }
  | { type: "viewers"; viewers: unknown[] }
  | { type: "changed" }
  | { type: "status"; status: string; error?: string };
export type PlatformEvent =
  | { type: "pairing"; url: string; pairGeneration: number }
  | (PlatformLiveEvent & { liveGeneration: number });
export interface PlatformConnection {
  username: string;
  publication?: PlatformPublication;
}
/**
 * The hosted representation of the page (GET /api/library/:id/host) as the
 * frame hands it to the document: the state without the link capability and
 * the boot without the page grant, which both stay inside the frame.
 */
export interface PlatformPage {
  state: import("../contracts.ts").DocumentState;
  seed: import("../af-contracts.ts").AfJsonObject | null;
  boot: {
    fileId: string;
    version: number;
    url: string;
    permissions: import("../contracts.ts").FilePermissions;
    username: string | null;
    home: string;
    path: string;
  };
}
/** Backend routes a page may call through the frame, under /api/files/:id/. */
export type PlatformBackendPath = "graphql" | "backends";
export interface PlatformBackendResult {
  status: number;
  body: unknown;
}
export type PlatformCommand =
  | { kind: "init"; binding: PlatformBinding }
  | { kind: "pair"; pairGeneration: number }
  | { kind: "request"; operation: PlatformOperation }
  /** Open the page as whoever the frame currently is (nobody, the link, or the connected account). */
  | { kind: "page" }
  /** A backend call or listing with the frame's credential; the status and body come back as they are. */
  | { kind: "backend"; path: PlatformBackendPath; method: "GET" | "POST"; body?: unknown }
  | {
      kind: "live.start";
      sessionId: string;
      sourceRevision: string;
      liveGeneration: number;
    }
  | { kind: "live.presence"; presence: unknown }
  | { kind: "live.stop" }
  | { kind: "disconnect" }
  | { kind: "dispose" };
export interface PlatformRequest {
  pagegiPlatform: 1;
  session: string;
  seq: number;
  id: string;
  command: PlatformCommand;
}
export type PlatformMessage =
  | {
      pagegiPlatform: 1;
      session: string;
      kind: "response";
      id: string;
      ok: true;
      value: unknown;
    }
  | {
      pagegiPlatform: 1;
      session: string;
      kind: "response";
      id: string;
      ok: false;
      error: string;
      status?: number;
    }
  | { pagegiPlatform: 1; session: string; kind: "event"; event: PlatformEvent };
export interface PlatformClient {
  ready: Promise<void>;
  pair(): Promise<PlatformConnection>;
  request(operation: PlatformOperation): Promise<any>;
  page(): Promise<PlatformPage>;
  backend(path: PlatformBackendPath, method: "GET" | "POST", body?: unknown): Promise<PlatformBackendResult>;
  startLive(value: {
    sessionId: string;
    sourceRevision: string;
  }): Promise<void>;
  sendPresence(presence: unknown): Promise<boolean>;
  stopLive(): Promise<void>;
  disconnect(): Promise<void>;
  dispose(): void;
}
export const PLATFORM_MAX_BYTES = 8 * 1024 * 1024;
export const PLATFORM_MAX_PENDING = 16;
