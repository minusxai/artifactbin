import type { PathEntry, PathChange } from "../contracts.ts";
/** Owns the account path namespace and its atomic folder/document moves. */
export interface PathCatalog {
  paths(actor: string): Promise<PathEntry[]>;
  changePath(actor: string, change: PathChange): Promise<PathEntry[]>;
}
