import type { DocumentSnapshot } from "./policy/contracts.ts";
/** An immutable migration authority link, never inferred from a title or path. */
export interface MigratedDatasetLifecycleLink {
  sourceNamespace: string;
  legacyId: string;
  pageId: string;
  authoritySha256: string;
}
export interface MigratedDatasetLifecycleProjection {
  link: MigratedDatasetLifecycleLink;
  owner: string;
  fileOwner: string;
  snapshotId: string;
  deleted: boolean;
}
/** Pure projection keeps every immutable snapshot field except current lifecycle. */
export type ProjectMigratedDatasetLifecycle = (
  snapshot: DocumentSnapshot,
  expected: { sourceNamespace: string; pageId: string; owner: string },
  current: MigratedDatasetLifecycleProjection | null,
) => DocumentSnapshot;
