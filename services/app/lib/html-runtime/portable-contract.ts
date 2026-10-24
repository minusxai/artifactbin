import type { HtmlJsonObject } from '@artifactbin/contracts';
import type {PortableIdentity} from '@artifactbin/contracts';
export type {PortableIdentity} from '@artifactbin/contracts';
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
  /** Explicit Save may adopt server-assigned IDs only if selected author bytes still match publication input. */
  publishedSource?: { source:string; localSourceDigest:string };
  portable: PortableDocument;
  privateState?: HtmlJsonObject;
}
