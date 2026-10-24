import type { NativeTypedAnalysis } from "./analyze-contracts.ts";
import type { NativeIdentityRevision } from "./identity-contracts.ts";
export interface NativeContentsEntry {
  level: 1 | 2 | 3;
  title: string;
  sourceNode: string;
  afId: string;
}
export interface NativeReaderTemplateInput {
  analysis: NativeTypedAnalysis;
  identity: NativeIdentityRevision;
  /** Digest of exact retained revision record carrying meta.template, not a current-head substitute. */
  sourceRecordSha256: string;
  template: string | null;
  chrome: boolean;
}
export interface NativeReaderTemplateReceipt {
  key: NativeTypedAnalysis["key"];
  sourceSha256: string;
  analysisSha256: string;
  documentSha256: string;
  compilerSourceSha256: string;
  identityProofSha256: string;
  sourceRecordSha256: string;
  template: string | null;
  chrome: boolean;
  entries: readonly NativeContentsEntry[];
  rail: boolean;
  sha256: string;
}
export interface NativeReaderTemplateOutput {
  html: string;
  css: string;
  authorJs: string;
}
