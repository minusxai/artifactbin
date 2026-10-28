import type { HtmlJsonObject } from '@artifactbin/contracts';
import type { StatePort, StoreReceipt } from './apollo/apollo-contracts';
export interface ViewerStateOptions {
  initial?: HtmlJsonObject;
  /** An explicit af-state URL replaces this viewer's prior document. */
  replaceInitial?: boolean;
  storage: { read(): string | null; write(json: string): void };
  /** Browser storage notifications from another tab of this viewer only. */
  observe(listener: () => void): () => void;
  /** Navigator Locks serializes compare-and-swap across tabs of the same page origin. */
  lock?: (work: () => Promise<StoreReceipt>) => Promise<StoreReceipt>;
}
export interface ViewerStatePort extends StatePort { dispose(): void }
