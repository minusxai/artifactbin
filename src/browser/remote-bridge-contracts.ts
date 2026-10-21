/**
 * Backend calls from a page to POST /api/files/:id/graphql. The page realm
 * (runner origin) never holds a token: it posts a request to the platform
 * frame, which calls the server with the viewer's own session and replies.
 *
 *   page → platform  { pagegi, channel, kind: "remote-request", id, request }
 *   platform → page  { pagegi, channel, kind: "remote-response", response }
 */
import type { AfJsonObject, Outcome } from "../af-contracts.ts";
import type { RemotePort, ResultError } from "../apollo/apollo-contracts.ts";

export interface RemoteBridgeRequest {
  query: string;
  variables: AfJsonObject;
  operation: "query" | "mutation";
}
export interface RemoteBridgeResponse {
  id: string;
  response?: {
    data: AfJsonObject | null;
    errors?: ResultError[];
    extensions?: { outcomes: Record<string, Outcome> };
  };
  /** `sent: false` proves the server never saw the request (the call settles offline). */
  error?: { message: string; sent: boolean };
}

export interface RemoteClientOptions {
  send(message: { kind: "remote-request"; id: string; request: RemoteBridgeRequest }): void;
  id(): string;
  online(): boolean;
  schedule(callback: () => void, delay: number): () => void;
  /** No reply in this long: the outcome is unknown. Default 30 000 ms. */
  timeoutMs?: number;
}
export interface RemoteClient {
  port: RemotePort;
  receive(response: RemoteBridgeResponse): void;
  dispose(): void;
}

export interface RemoteHostOptions {
  /** `/api/files/<id>/graphql`, or null when the page is not published. */
  endpoint(): string | null;
  active(): boolean;
  online(): boolean;
  /** POST JSON with the viewer's own session; resolves with the HTTP status and parsed body. */
  post(url: string, body: AfJsonObject): Promise<{ status: number; body: unknown }>;
  reply(response: RemoteBridgeResponse): void;
}
export interface RemoteHost {
  /** True when the message was a remote request (handled or refused). */
  handle(message: unknown): boolean;
}
