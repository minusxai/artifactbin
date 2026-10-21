import type { Profile, LibraryFile } from "../contracts.ts";
/** Read-only metadata and locators for a document; credentials never grant access through a locator. */
export interface DocumentCatalog {
  profiles(fileId: string, actors: string[]): Promise<Record<string, Profile>>;
  library(actor: string): Promise<LibraryFile[]>;
  discover(actor: string | null, publicOnly?: boolean): Promise<LibraryFile[]>;
  sharedLink(id: string): Promise<string | null>;
  resolveSharedPath(space: string, path: string): Promise<string | null>;
  resolvePath(actor: string, path: string): Promise<string | null>;
  filePath(actor: string, id: string): Promise<string | null>;
}
export type CollaborationCatalog = Pick<
  DocumentCatalog,
  "profiles" | "sharedLink"
>;
