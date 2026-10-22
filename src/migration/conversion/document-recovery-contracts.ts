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
