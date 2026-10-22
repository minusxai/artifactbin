/** Generated module bytes only. Readable HTML, CSS and viewer state stay outside this envelope. */
export interface CompiledJavascriptPayload {
  readonly compression: "gzip";
  readonly base64: string;
  readonly sha256: string;
  readonly uncompressedBytes: number;
}
export interface CompiledPayloadLoader {
  readonly settled: Promise<void>;
  /** A persisted pagehide freezes the existing boot; it must not start a second module. */
  pagehide(persisted: boolean): void;
}
export interface CompiledPayloadLoaderPorts {
  decode(signal: AbortSignal): Promise<string>;
  createURL(source: string): string;
  revokeURL(url: string): void;
  importModule(url: string): Promise<unknown>;
  error(): void;
}
