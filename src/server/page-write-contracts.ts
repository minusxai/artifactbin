import type { FileId } from "../af-contracts.ts";
import type { Visibility, ShareRole } from "../contracts.ts";
import type { BackendLink, PreparedPage } from "../page/page-contracts.ts";
import type { CompiledBackend } from "../backend/contracts.ts";
/** Session lookup and share authorization use distinct empty-credential semantics. */
export interface PageWriteCredential {
  sessionHash: string;
  shareHash: string | null;
}
export interface PublishedPage {
  id: FileId;
  version: 1;
  source: string;
  path: string;
}
export interface PagePublicationResult {
  kind: "created" | "replayed";
  page: PublishedPage;
}
export interface PageSaveResult {
  status: number;
  value: { version: number; source: string };
  changed: boolean;
}
export interface PageSaveBase {
  actor: string;
  owner: string;
  ownerKind: "user" | "group" | undefined;
  version: number;
  reserved: ReadonlySet<string>;
  nextNodeId: number;
}
/** Opaque repository-issued preparation. Compile delegates outside all transactions. */
export interface PageBackendPreparation {
  compile(signal?: AbortSignal): Promise<Record<FileId, CompiledBackend>>;
}
export interface PageWriteRepository {
  inspectPublication(input: {
    credential: PageWriteCredential;
    requestId: string;
    fingerprint: string;
  }): Promise<{ actor: string; replayed: PublishedPage | null }>;
  inspectSave(input: {
    credential: PageWriteCredential;
    id: FileId;
    expected: number | null;
    key: string | null;
    fingerprint: string;
  }): Promise<
    | { replay: PageSaveResult; base: null }
    | { replay: null; base: PageSaveBase }
  >;
  preflightBackends(input: {
    actor: string;
    links: readonly BackendLink[];
    files: Readonly<Record<FileId, string>>;
  }): Promise<PageBackendPreparation | null>;
  commitPublication(input: {
    credential: PageWriteCredential;
    actor: string;
    requestId: string;
    fingerprint: string;
    requestedId: FileId | null;
    requestedPath: string | null;
    folder: string;
    visibility: Visibility;
    linkRole: ShareRole;
    backends: PageBackendPreparation | null;
    compiled: Readonly<Record<FileId, CompiledBackend>>;
    /** Pure synchronous final preparation, after the ID is claimed. */
    prepareForId(id: FileId): PreparedPage;
  }): Promise<PagePublicationResult>;
  commitSave(input: {
    credential: PageWriteCredential;
    id: FileId;
    base: PageSaveBase;
    prepared: PreparedPage;
    backends: PageBackendPreparation | null;
    compiled: Readonly<Record<FileId, CompiledBackend>>;
    key: string | null;
    fingerprint: string;
  }): Promise<PageSaveResult>;
}
