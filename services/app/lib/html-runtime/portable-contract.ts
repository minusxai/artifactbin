import type { HtmlJsonObject } from '@artifactbin/contracts';
/** Public provenance only. Reserving an ID does not create this published identity. */
export interface PortableIdentity {
  platformOrigin: string;
  artifactId: string;
  baseRevision: string;
  sourceDigest: string;
  dependencyIdentity?: Readonly<Record<string, string>>;
}
/** Canonical author bytes are independent of the live DOM and bootstrap code. */
export interface PortableDocument {
  version: 1;
  source: string;
  /** Digest of normalized rendered asset substitutions; original source remains authoritative. */
  renderedDigest?: string;
  identity?: PortableIdentity;
  privateState?: HtmlJsonObject;
}
export interface OriginalFilePort {
  read(): Promise<string>;
  write(source: string): Promise<void>;
}
/** A local save captures only canonical source, immutable bootstrap assets and explicitly allowed state. */
export interface PortableCopyOptions {
  document: Document;
  /** Actual selected file/helper response bytes; stale embedded source is never authoritative. */
  sourceBytes: string;
  portable: PortableDocument;
  privateState?: HtmlJsonObject;
}
