import type { NativeTypedAnalysis } from "./analyze-contracts.ts";
import type { NativeIdentityRevision } from "./identity-contracts.ts";
export interface NativeMarkdownParse {
  sourceNode: string;
  source: string;
  html: string;
  headings: readonly { level: 1 | 2 | 3; title: string }[];
  errors: readonly string[];
}
export interface NativeMarkdownReceipt extends NativeMarkdownParse {
  analysisSha256: string;
  sourceSha256: string;
  nodeSha256: string;
  parserSha256: string;
  hostAfId: string;
  hostDomId: string;
  sha256: string;
}
export interface NativeMarkdownInput {
  analysis: NativeTypedAnalysis;
  identity: NativeIdentityRevision;
  parsed: readonly NativeMarkdownParse[];
  parserSha256: string;
}
