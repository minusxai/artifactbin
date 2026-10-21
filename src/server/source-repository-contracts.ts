import type { DocumentAuthorizationRecord } from "./document-authorization-contracts.ts";
import type { SessionGrant } from "../identity-data-contracts.ts";
export interface SourceHeader extends DocumentAuthorizationRecord {
  head: string;
  /** Digest of the head source, when the loader reads it. */
  sourceDigest?: string | null;
}
export interface StoredSource {
  revision: string;
  content: string;
}
export interface SourceRequest {
  fileId: string;
  tokenHash: string;
}
export interface SourceReadContext {
  document: SourceHeader | null;
  session: SessionGrant | null;
  source: StoredSource | null;
}
export interface SourceWriteContext {
  document: SourceHeader | null;
  session: SessionGrant | null;
}
export interface SourceCommit<T> {
  value: T;
  source: StoredSource;
  replaceHead: boolean;
}
export interface SourceRepository {
  read<T>(
    request: SourceRequest & { revision?: string },
    work: (context: SourceReadContext) => T,
  ): Promise<T>;
  change<T>(
    request: SourceRequest,
    work: (context: SourceWriteContext) => SourceCommit<T>,
  ): Promise<T>;
}
