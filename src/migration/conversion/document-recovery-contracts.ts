/** Retained source and canonical AST are independent witnesses; no source is evaluated. */
export interface LegacyDocumentRecoveryOracle {
  ownSource(ast: unknown): string;
  canonicalDocument(document: unknown): string;
  canonicalSource(source: string): string;
}
export interface LegacyDocumentSourceRecovery {
  source: string;
  repairedNodes: number;
}
export type RecoverLegacyDocumentSource = (
  document: unknown,
  oracle: LegacyDocumentRecoveryOracle,
) => LegacyDocumentSourceRecovery | null;

/** Partial rendering only: root sibling positions are retained, missing content is explicit. */
export interface LegacyPartialDocumentRecovery {
  source: string;
  missingNodes: number;
}

/** Retired source wrapper accepted only by explicit offline migration, never ordinary graph decoding. */
export type RecoverRetiredSourceWrapper = (
  document: unknown,
) => { source: string } | null;
