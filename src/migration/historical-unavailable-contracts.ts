/** Explicit offline preservation policy; never makes an unsupported current head ready. */
export type HistoricalUnavailablePolicy = "preserve";
export interface HistoricalUnavailableReceipt {
  kind: "historical-conversion-unavailable";
  policyVersion: 1;
  version: number;
  originalFormat: string;
  /** Complete original revision row retained by the immutable migration archive. */
  originalRecordSha256: string;
  originalSourceSha256?: string;
  originalDocumentSha256?: string;
  reasonCodes: readonly string[];
  /** Converter evidence remains evidence of failure, never a receipt for fallback HTML. */
  failedConversionReceipt?: {
    compilerIdentity: string;
    inputSha256: string;
    outputSha256: string;
  };
}
/** Planned representations; independent page readiness still controls actual import. */
export interface HistoricalUnavailableCounts {
  pages: number;
  revisions: number;
}
