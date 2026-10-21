/** Offline migration only. This module is never imported by serving or browser code. */
export interface ConversionIssue {
  code: string;
  message: string;
  path: string;
}
export interface ConversionInput {
  source: string;
  coreUrl: string;
  styles?: string[];
  designSystem?: string;
}
export interface ConversionResult {
  classification: "renderable" | "functional" | "manual-blocked";
  html: string | null;
  issues: ConversionIssue[];
  identities: Record<string, string>;
  capabilities: string[];
}
/** Canonical archived graph v3 stores source fragments around ordered children. */
export interface LegacyDocumentGraphNode {
  parts: string[];
  children: string[];
  parent?: string | null;
}
export interface LegacyDocumentGraph {
  kind: "graph";
  schema: 3;
  nodes: Record<string, LegacyDocumentGraphNode>;
}
export interface ConversionInventoryRow {
  source?: string | null;
  document?: unknown;
}
export interface ConversionInventory {
  total: number;
  classifications: Record<ConversionResult["classification"], number>;
  /** Counts of documents with each code, excluding source, titles, identities and messages. */
  issueDocuments: Record<string, number>;
  issueOccurrences: Record<string, number>;
  capabilities: Record<string, number>;
}
