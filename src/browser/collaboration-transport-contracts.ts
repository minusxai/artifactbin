import type { PresenceInput } from "../contracts.ts";
import type {
  PlatformClient,
  PlatformLiveEvent,
} from "./platform-contracts.ts";
import type { SessionTransport } from "./collaboration-session-contracts.ts";
import type {
  LiveClientOptions,
  LiveClient,
} from "../live-client-contracts.ts";
export interface CollaborationTransportOptions {
  connection(): {
    origin: string;
    fileId: string;
    token: string;
    sourceRevision: string;
    /** The server's number for the open version (see comment-wire.ts). */
    version?: number;
  };
  sessionId: string;
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit,
  ) => Promise<Response>;
  openLive?(options: LiveClientOptions): LiveClient;
}
export interface BrokerCollaborationOptions {
  client(): PlatformClient;
  binding(): { sessionId: string; sourceRevision: string };
  presence(): PresenceInput;
}
export interface BrokerCollaborationTransport extends SessionTransport {
  event(event: PlatformLiveEvent): void;
}
