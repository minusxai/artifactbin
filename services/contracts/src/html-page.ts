import type { ReviewJson } from './comment-view-state';
/** Immutable page versions, independent of the application's original actor/ACL model. */
export type HtmlJson = ReviewJson;
export type HtmlJsonObject = { [key: string]: HtmlJson };
export interface HtmlBackendLink { kind: 'backend'; name: string; backendId: string; version: string }
/** Archived pages explicitly keep live bindings live; pinned bindings always read their recorded revision. */
export type HtmlDatasetLink = { kind: 'dataset'; name: string; datasetId: string } &
  ({ mode: 'live' } | { mode: 'pinned'; revision: string });
export type HtmlPageLink = HtmlBackendLink | HtmlDatasetLink;
export interface HtmlPageVersion {
  pageId: string; version: number; revision: string; html: string;
  nextNodeId: number; links: readonly HtmlPageLink[];
}
export interface SaveHtmlPageRequest {
  pageId?: string; expectedRevision?: string; requestId: string; html: string;
  /** Named resolver TypeScript files, one per `<link rel="af-resolver">`. */
  resolverSources?: Readonly<Record<string, string>>;
  /** Permanent legacy alias of `resolverSources`; sending both is refused. */
  backendSources?: Readonly<Record<string, string>>;
}
/** Link rels that declare a resolver namespace. `af-backend` is a permanent parse alias of `af-resolver`. */
export const RESOLVER_LINK_RELS = ['af-resolver', 'af-backend'] as const;
/**
 * A resolver version's file contract. 1: legacy capabilities (`caps.store`, `caps.secrets.get`,
 * `secretBindings`), kept for already-published code. 2: the resolver contract (`secrets` map).
 */
export type ResolverApi = 1 | 2;
/** Secret name to the one host that may receive it: exact, or one leading `*.` label. Never values. */
export type ResolverSecretHosts = Readonly<Record<string, string>>;
/** Publish-time facts about one resolver version that the app shows its owner. */
export interface ResolverContract {
  api: ResolverApi; secretHosts: ResolverSecretHosts;
  /** Declares the optional `test: String! @auth(role: owner)` Query field behind Test connection. */
  test: boolean;
}
export interface HtmlPublicationReceipt { pageId: string; version: number; revision: string; created: boolean }
/** Instantiate A with original AccessActor. Do not reconstruct it from page-supplied principal fields. */
export interface HtmlPublication<A> {
  save(actor: A, input: SaveHtmlPageRequest, signal?: AbortSignal): Promise<HtmlPublicationReceipt>;
  read(actor: A, pageId: string, revision?: string): Promise<HtmlPageVersion>;
}
