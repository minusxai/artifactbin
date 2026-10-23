/** Offline source normalization only. Archived source and document bytes remain authoritative. */
export interface LegacyScriptMigration {
  source: string;
  changed: boolean;
  applied: string[];
  unresolved: string[];
}
export interface LegacyScriptNormalizationReceipt {
  kind: "original-managed-frame-codemod" | "original-scalar-params-codemod";
  paramsBridgeVersion?: "scalar-params-v1";
  /** Exact upstream classic library bytes embedded in a lexical frame binding. */
  dayjs?: { version: "1.11.13"; sourceSha256: string };
  codemodCommit: string;
  codemodSha256: string;
  originalSourceSha256: string;
  derivedSourceSha256: string;
  /** Count only: original tool descriptions can contain authored titles and IDs. */
  appliedRuleCount: number;
}
export interface LegacyScriptNormalization {
  source: string;
  receipt: LegacyScriptNormalizationReceipt;
}
export interface LegacyScriptNormalizerPort {
  migrate(source: string): Promise<LegacyScriptMigration>;
}

export interface LegacyDayjsNormalization {
  source: string;
  dayjs?: NonNullable<LegacyScriptNormalizationReceipt["dayjs"]>;
}
