/** Offline source normalization only. Archived source and document bytes remain authoritative. */
export interface LegacyScriptMigration {
  source: string;
  changed: boolean;
  applied: string[];
  unresolved: string[];
}
export interface LegacyScriptNormalizationReceipt {
  kind: "original-managed-frame-codemod";
  codemodCommit: string;
  codemodSha256: string;
  originalSourceSha256: string;
  derivedSourceSha256: string;
  applied: readonly string[];
}
export interface LegacyScriptNormalization {
  source: string;
  receipt: LegacyScriptNormalizationReceipt;
}
export interface LegacyScriptNormalizerPort {
  migrate(source: string): Promise<LegacyScriptMigration>;
}
