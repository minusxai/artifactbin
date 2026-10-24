import type { HtmlPageVersion, Queryable } from "@artifactbin/contracts";
import type { publishBundleDependencies } from "@/lib/html-publication-bundle";
import type { HtmlIdentityLedger } from "@/lib/html-page";
import type { createArtifact } from "@/lib/artifacts";
import type { prepareRegisteredQueryBackend } from "@/lib/registered-page-queries/registry";
import type { prepareRegisteredMutationBackend } from "@/lib/registered-page-mutations";
/** Offline, trusted projection only. Never an HTTP request or authored backend argument. */
export interface NativeHistoryRevision {
  page: HtmlPageVersion;
  /** Cumulative lifetime allocation ledger; counters never decrease. Identity continuity is proven by the trusted source projector. */
  ledger: HtmlIdentityLedger;
  /** Actual publication bundle receipts; omission and an explicitly empty bundle remain distinct. */
  htmlPublicationDependencies?: Readonly<Awaited<ReturnType<typeof publishBundleDependencies>>["receipts"]>;
  sourceSha256: string;
  title: string | null;
  description: string | null;
  createdAt: string;
  actorUserId: string | null;
  actorTokenId: string | null;
  queries: readonly ReturnType<typeof prepareRegisteredQueryBackend>[];
  mutations: readonly ReturnType<typeof prepareRegisteredMutationBackend>[];
}
export interface NativeHistoryImport {
  sourceNamespace: string;
  sourceId: string;
  /** Digest from the existing source selection ledger; no selection/revision expansion. */
  selectionSha256: string;
  projectionSha256: string;
  /** Existing retained relation projection digest; requires same-transaction apply+verify adapter. */
  relationSha256?: string;
  pageId: string;
  owner: { userId: string; tokenId: string };
  visibility: "public" | "unlisted" | "private";
  linkRole: "viewer" | "commenter" | "editor";
  shares: NonNullable<Parameters<typeof createArtifact>[3]>["shares"];
  headVersion: number;
  revisions: readonly NativeHistoryRevision[];
}
/** Relation adapters reuse retained projections, execute inside the SAME transaction, and verify stored results.
 * Supply before enabling comments/assets/dataset imports. This writer does not fabricate those projections. */
export interface NativeImportRelations {
  sourceSha256: string;
  /** Exact head-only metadata owned and verified by the relation adapter; writer keys cannot be overridden. */
  headMetadata?: { readonly nativeRelationContext: unknown };
  apply(tx: Queryable, pageId: string): Promise<void>;
  verify(tx: Queryable, pageId: string): Promise<void>;
}
