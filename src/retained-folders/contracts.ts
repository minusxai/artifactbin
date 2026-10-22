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

/** Mapped, immutable ACL evidence supplied by the postimport authority preparation.
 * The source descriptor and policy must be verified before invoking this trusted port. */
export interface RetainedFolderRegistration {
  descriptor: RetainedFolderDescriptor;
  access: import("../contracts.ts").AccessPolicy;
}
export interface RetainedFolderPage {
  id: string;
  title: string;
  /** Only independently readable ancestors and immediate children are returned. */
  trail: readonly { id: string; title: string; url: string }[];
  rows: readonly {
    id: string;
    title: string;
    kind: "folder" | "page";
    url: string;
  }[];
}
export interface RetainedFolderService {
  /** Credentials are resolved fresh inside the transaction. Invalid/scoped/expired grants fall back to anonymous.
   * Null means absent, deleted, trashed, ambiguous or unreadable; it never reveals which.
   * More than 500 immediate page or 500 related folder candidates fails with 503, never truncates. */
  read(
    legacyId: string,
    credential?: string,
    namespace?: string,
  ): Promise<RetainedFolderPage | null>;
}

/** Trusted offline port. Implementations atomically CAS paths and retain exact application receipts. */
export type RetainedFolderExecutor = (
  plan: FolderTitlePlan,
  registrations: readonly RetainedFolderRegistration[],
) => Promise<"applied" | "already-applied" | "stale">;

/** Exact postimport receipt includes each permanently occupied registry ID. */
export interface RetainedFolderApplicationReceipt {
  plan: FolderTitlePlan;
  registrations: readonly RetainedFolderRegistration[];
  registry: readonly {
    id: string;
    owner: string;
    kind: "folder";
    published: true;
    createdAt: 0;
  }[];
}
