/** The durable attachment receipt shared by browser controls and CLI uploads. */
export interface DatasetUploadResult {
  ref: string;
  url: string;
  name: string;
  contentType: string;
  size: number;
  replayed?: boolean;
}

/** Picker availability only. The server rechecks dataset grants for every write. No account identity or credentials cross the frame. */
export interface UploadContext {
  state: 'loading' | 'signed-out' | 'signed-in' | 'read-only' | 'unavailable';
  /** Opaque incarnation; changes invalidate in-flight results, including account switches. */
  scope: string;
}
