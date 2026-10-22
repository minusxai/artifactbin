/** Trusted deployment-mounted immutable dataset bytes; never served over HTTP. */
export interface DatasetObjectStore {
  read(key: string, signal?: AbortSignal): Promise<AsyncIterable<Uint8Array>>;
}
