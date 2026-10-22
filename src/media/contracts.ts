/** Immutable binding: bytes are always authorized through this asset page, never its parent. */
export interface MediaAddress {
  readonly pageId: string;
  readonly revision: string;
  readonly variant: "original" | "small";
  readonly sha256: string;
}
export interface MediaDescriptor extends MediaAddress {
  readonly contentType: string;
  readonly filename: string | null;
  readonly byteLength: number;
  /** Flat local object name, exactly sha256. Never an authored path. */
  readonly storageKey: string;
}
export interface MediaReadRepository {
  /** Returns null for missing or unauthorized assets; rechecks current asset-page ACL per call. */
  read(
    address: MediaAddress,
    credential: string,
  ): Promise<MediaDescriptor | null>;
}
export interface MediaRange {
  readonly start: number;
  readonly end: number;
}
export interface MediaObject {
  stream(range?: MediaRange): AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}
export interface MediaStore {
  open(descriptor: MediaDescriptor): Promise<MediaObject>;
}
export interface MediaRequest {
  readonly address: MediaAddress;
  readonly credential: string;
  readonly method: "GET" | "HEAD";
  readonly range?: string;
}
export interface MediaResponse {
  readonly status: 200 | 206 | 404 | 416 | 503;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}
