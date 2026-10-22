import type { AccessPolicy } from "../contracts.ts";
import type { DatasetBinding, DatasetTable } from "./contracts.ts";
import type { DatasetSnapshot, DocumentSnapshot } from "./policy/contracts.ts";
/** Trusted offline import descriptor. None of these facts may come from page or resolver input. */
export interface DatasetImportMetadata {
  sourceNamespace: string;
  bindings: readonly DatasetBinding[];
  pages: readonly {
    pageId: string;
    pageVersion: number;
    snapshot: DocumentSnapshot;
  }[];
  /** Current authority is separate from the immutable historical row catalogs. */
  resources: readonly {
    legacyId: string;
    currentVersion: number;
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
  acceptedJoins: readonly { pageId: string; legacyUserId: string }[];
}
