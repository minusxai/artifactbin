/** Durable commit-ordered sequence. Decimal strings preserve bigint precision. */
export interface LiveInvalidation {
  sequence: string;
  pageIds: readonly string[];
}
export interface LiveInvalidationReader {
  after(sequence: string, limit: number): Promise<readonly LiveInvalidation[]>;
}
export interface LiveInvalidationClock {
  after(ms: number, callback: () => void): () => void;
}
export interface LiveInvalidationConsumer {
  readonly sequence: string;
  poll(): Promise<void>;
  close(): Promise<void>;
}
export interface LiveInvalidationOptions {
  reader: LiveInvalidationReader;
  changed(pageId: string): void | Promise<void>;
  clock?: LiveInvalidationClock;
  intervalMs?: number;
  autoStart?: boolean;
  onError?(error: unknown): void;
}
