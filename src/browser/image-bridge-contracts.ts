import type { PlatformImage } from "./platform-contracts.ts";
export interface ImageReply {
  id: string;
  image?: PlatformImage;
  error?: string;
}
export interface ImageBridgeClient {
  setAuthority(context: string | null): void;
  load(url: string, signal?: AbortSignal): Promise<Blob>;
  receive(reply: ImageReply): void;
  dispose(): void;
}
export interface ImageBridgeClientOptions {
  send(
    message:
      | {
          kind: "image-request";
          id: string;
          url: string;
          authorizationContext: string;
        }
      | { kind: "image-cancel"; id: string },
  ): void;
  id(): string;
  schedule(callback: () => void, ms: number): () => void;
}
export interface ImageBridgeHostOptions {
  pageId(): string | null;
  authority(): string | null;
  load(
    address: import("../media/supplemental-contracts.ts").PersonImageAddress,
    context: string,
    signal: AbortSignal,
  ): Promise<PlatformImage>;
  reply(reply: ImageReply): void;
}
