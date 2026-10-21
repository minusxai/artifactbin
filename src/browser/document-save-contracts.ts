export type SaveResult = "written" | "download-started";
export interface SaveStatus {
  dirty: boolean;
  version: number;
  saving: boolean;
  suspended: boolean;
  disposed: boolean;
  etag: string | undefined;
}
export interface SaveClock {
  set(callback: () => void, delay: number): unknown;
  clear(handle: unknown): void;
}
export interface SaveOptions<T> {
  capture(): T;
  write?(request: {
    snapshot: T;
    etag: string | undefined;
    version: number;
    signal: AbortSignal;
  }): Promise<{ etag: string }>;
  download(snapshot: T): void;
  etag?: string;
  delayMs?: number;
  clock?: SaveClock;
  onChange?(status: SaveStatus): void;
  onError?(error: Error): void;
}
export interface DocumentSave {
  readonly status: SaveStatus;
  touch(): void;
  save(): Promise<SaveResult>;
  suspend(): void;
  resume(): void;
  dispose(): void;
}
