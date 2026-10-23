import type { DatasetCallContext, DatasetReadResult } from "./contracts.ts";
/** Server-only saved-version projection. No backend execution, remote URLs or write ports. */
export interface HistoricalDatasetSelection {
  kind: "ready";
  context: DatasetCallContext;
  binding: string;
  version: number;
  tables: readonly { schema: string; name: string }[];
}
export interface HistoricalDatasetReplayPorts {
  /** Resolves only exact pinned standalone self-read registrations. */
  resolve(
    pageId: string,
    version: number,
    subject: string | null,
  ): Promise<HistoricalDatasetSelection | { kind: "unavailable" } | null>;
  read(
    selection: HistoricalDatasetSelection,
    table: { schema: string; name: string },
  ): Promise<DatasetReadResult>;
}
export interface HistoricalDatasetReplay {
  /** Null for ordinary pages; unavailable historical data is a visible inert notice. */
  render(
    pageId: string,
    version: number,
    subject: string | null,
  ): Promise<string | null>;
}
