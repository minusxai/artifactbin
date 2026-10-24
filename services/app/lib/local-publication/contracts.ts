import type { PortableIdentity } from '@artifactbin/contracts';

/** Explicitly selected browser files. Paths are relative to the chosen project folder. */
export interface LocalSelectedFile { path: string; bytes: Uint8Array; contentType: string }
export interface LocalPublicationInput { entryPath: string; html: string; files: LocalSelectedFile[]; title?: string }
export interface LocalPublicationBody {
  html: string;
  title?: string;
  visibility: 'private';
  publicationBundle: { entryPath: string; files: Array<{ path: string; contentType: string; base64: string }> };
}
export interface LocalPublicationPlan {
  entryPath: string;
  dependencies: Array<{ path: string; kind: 'asset' | 'dataset'; contentType: string; bytes: number; dependencies: string[] }>;
  backends?: Array<{ name: string; path: string; bytes: number }>;
  reusedPaths: string[];
  limits: { files: number; fileBytes: number; totalBytes: number };
}
export interface LocalPublicationReceipt {
  identity: PortableIdentity;
  source: string;
  localSourceDigest?: string;
  dependencyIdentity?: Readonly<Record<string, string>>;
}
/** A request snapshot is retained unchanged after errors, so retries cannot create a second page. */
export interface LocalPublicationRequest { key: string; body: LocalPublicationBody }
export const LOCAL_PUBLICATION_MESSAGE = 'af:local-publication';
