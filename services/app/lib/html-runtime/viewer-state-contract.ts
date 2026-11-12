import type { HtmlJsonObject } from '@artifactbin/contracts';
import type { StatePort, StoreReceipt } from './apollo/apollo-contracts';
export interface ViewerStateOptions {
  /** The page's defaults (its state block). The document is these with the viewer's overrides over them (./viewer-overrides). */
  defaults?: HtmlJsonObject;
  /** The page's state version (`data-af-state-version`); an entry of another version reads as the defaults until the first write. */
  version?: string | null;
  /** The page revision this instance runs; an entry a later revision wrote is never written over by this one. */
  revision?: string | null;
  /** An explicit af-state URL's document: replaces this viewer's overrides with its differences from the defaults. */
  seed?: HtmlJsonObject;
  /** This viewer's overrides entry. */
  storage: { read(): string | null; write(json: string): void };
  /** Browser storage notifications from another tab of this viewer only. */
  observe(listener: () => void): () => void;
  /** Navigator Locks serializes compare-and-swap across tabs of the same page origin. */
  lock?: (work: () => Promise<StoreReceipt>) => Promise<StoreReceipt>;
}
export interface ViewerStatePort extends StatePort { dispose(): void }
