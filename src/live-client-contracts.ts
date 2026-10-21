import type { LiveClientMessage, Viewer } from "./contracts.ts";
export interface LiveSocket {
  readyState: number;
  bufferedAmount: number;
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
}
export interface LiveClientOptions {
  url: string;
  auth(): Omit<Extract<LiveClientMessage, { type: "auth" }>, "type">;
  onReady(): void;
  onViewers(viewers: Viewer[]): void;
  onChanged(): void;
  onStatus(status: string, error?: string): void;
  socket?(url: string): LiveSocket;
  clock?: {
    setTimeout(callback: () => void, ms: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  random?(): number;
}
export interface LiveClient {
  send(message: LiveClientMessage): boolean;
  close(): void;
}
