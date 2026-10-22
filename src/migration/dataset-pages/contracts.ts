import type {
  CompiledDatasetBinding,
  DatasetReadRequest,
  DatasetReadWindow,
} from "../conversion/compiled/dataset-contracts.ts";

/** Public rendering metadata only: no original catalog, policy, SQL or storage keys. */
export interface StandaloneDatasetPageInput {
  title: string;
  coreUrl: string;
  source:
    | { kind: "stored"; binding: CompiledDatasetBinding }
    | { kind: "external"; registered: false };
}
export type StandaloneDatasetPagePlan =
  | {
      kind: "ready";
      title: string;
      coreUrl: string;
      binding: CompiledDatasetBinding;
    }
  | {
      kind: "unavailable";
      title: string;
      coreUrl: string;
      reason: "external-registration-required";
    };
export type DatasetPageCursor = Pick<
  DatasetReadWindow,
  | "version"
  | "generation"
  | "schema"
  | "table"
  | "offset"
  | "nextOffset"
  | "totalRows"
>;
export interface DatasetPageReader {
  /** Only an explicitly selected bounded window is retained. No eager table download. */
  read(
    tableIndex: number,
    offset?: number,
    previous?: DatasetPageCursor,
  ): Promise<DatasetReadWindow>;
}
export interface DatasetPageReaderOptions {
  pageSize?: number;
  maxBytes?: number;
  timeoutMs?: number;
}
export type DatasetPageReadPort = DatasetReadRequest;
