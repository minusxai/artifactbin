import type { DatasetOperationRegistration } from "./mutation/repository-contracts.ts";
import type { AccessPolicy } from "../contracts.ts";
import type { DatasetBinding, DatasetTable } from "./contracts.ts";
import type { DatasetSnapshot, DocumentSnapshot } from "./policy/contracts.ts";
/** Trusted offline import descriptor. None of these facts may come from page or resolver input. */
export interface DatasetImportMetadata {
  sourceNamespace: string;
  bindings: readonly DatasetBinding[];
  /** Trusted publication registry, inserted in the binding transaction; never browser metadata. */
  operations?: readonly DatasetOperationRegistration[];
  pages: readonly {
    pageId: string;
    pageVersion: number;
    snapshot: DocumentSnapshot;
  }[];
  /** Current authority is separate from the immutable historical row catalogs. */
  resources: readonly {
    legacyId: string;
    currentVersion: number;
    /** Only authoritative legacy access=readwrite enables writes; absence denies. */
    writable?: boolean;
    policyRevision: number;
    owner: string;
    generation: number;
    access: AccessPolicy;
    deleted: boolean;
    snapshot: DatasetSnapshot;
  }[];
  versions: readonly {
    legacyId: string;
    version: number;
    tables: readonly DatasetTable[];
    /** Complete original catalog, including unsupported model/external metadata; never executed or returned. */
    catalog: unknown;
    unavailableTables: readonly {
      schema: string;
      name: string;
      reason: "external" | "model";
    }[];
  }[];
  /** Token rows retain ownership provenance only: they never authenticate a dataset caller. */
  principals: readonly {
    actor: string;
    kind: "user" | "token";
    legacyId: string;
    identity: "user" | "guest" | "testuser";
    expiresAt: string | null;
  }[];
  groups: readonly { owner: string; legacyGroupId: string }[];
  /** Current accepted joins; removals take effect on the next authority read. */
  /** Original public cards kept separately from mutable login accounts; never contains email or storage keys. */
  profiles?: readonly {
    legacyUserId: string;
    name: string;
    handle: string | null;
    image: string | null;
  }[];
  /** Exact server-only registered bound Value column descriptors. */
  personBindings?: readonly import("./person-contracts.ts").DatasetPersonBinding[];
  acceptedJoins: readonly {
    pageId: string;
    legacyUserId: string;
    /** Original accepted join instant; absent legacy values are unavailable, never synthesized. */
    joinedAt?: string | null;
  }[];
}
