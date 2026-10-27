import type { NativeTypedAnalysis } from "./analyze-contracts.ts";
import type { NativeIdentityRevision } from "./identity-contracts.ts";
export interface NativeContentsEntry {
  level: 1 | 2 | 3;
  title: string;
  sourceNode: string;
  afId: string;
  /** Exact existing af-markdown generated heading DOM id; host identity remains afId. */
  domId?: string;
}
export interface NativeReaderTemplateInput {
  analysis: NativeTypedAnalysis;
  markdown?: readonly import("./markdown-contracts.ts").NativeMarkdownReceipt[];
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
  /** Source reader chrome surrounds the authored column when a supported deck has multiple slides. */
  deckRail?: true;
  /** Source ordinary tables retain overflow marks as layout changes. */
  scrollTables?: true;
  sha256: string;
}
export interface NativeReaderTemplateOutput {
  html: string;
  css: string;
  authorJs: string;
}

/** Native panels preserve children and change hidden; retained hydration rebuilds
 * children. Both must refresh the source-bound outline after visibility settles. */
export interface NativeContentsMutationOptions {childList:true;subtree:true;attributes:true;attributeFilter:readonly ['hidden']}
