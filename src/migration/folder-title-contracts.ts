import type { PathEntry } from "../contracts.ts";

/** Immutable source evidence. IDs and paths are trusted import metadata, never request authority. */
export interface RetainedFolderDescriptor {
  namespace: string;
  legacyId: string;
  owner: string;
  title: string;
  /** Root to immediate parent, excluding this folder. */
  ancestorIds: readonly string[];
  sourceRevision: string;
  deleted: boolean;
  /** Exact path emitted by the verified base import; never inferred from an ID. */
  expectedPath: string | null;
}
export type RetainedFolderLocation = {
  namespace: string;
  legacyId: string;
  owner: string;
  sourceRevision: string;
} & (
  | { state: "live"; path: string }
  | { state: "trash"; path: string; trashId: string }
  | { state: "deleted" }
);
export interface FolderTitlePlan {
  kind: "ready";
  /** Executor must compare this complete owner path snapshot under its path lock. */
  expected: Readonly<Record<string, readonly PathEntry[]>>;
  changes: readonly { owner: string; from: string; path: string }[];
  result: Readonly<Record<string, readonly PathEntry[]>>;
  locations: readonly RetainedFolderLocation[];
}
export type FolderTitlePlanResult =
  | FolderTitlePlan
  | {
      kind: "conflict";
      reason:
        | "invalid-inventory"
        | "stale-location"
        | "invalid-path"
        | "collision";
    };
/** Postimport repository port: the transaction must lock owners, CAS all expected paths,
 * apply all changes and locations together, and retain an exact before/after receipt.
 * A failed comparison changes nothing. This port confers no browsing or write authority. */
export interface RetainedFolderLocationRepository {
  read(
    namespace: string,
    legacyId: string,
  ): Promise<RetainedFolderLocation | null>;
  apply(plan: FolderTitlePlan): Promise<"applied" | "stale">;
}
export type FolderLocationChange =
  | { kind: "move"; owner: string; from: string; path: string }
  | { kind: "trash"; owner: string; path: string; trashId: string }
  | {
      kind: "restore";
      owner: string;
      trashId: string;
      from: string;
      path: string;
    };
