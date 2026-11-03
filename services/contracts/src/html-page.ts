import type { ReviewJson } from './comment-view-state';
/** Immutable page versions, independent of the application's original actor/ACL model. */
export type HtmlJson = ReviewJson;
export type HtmlJsonObject = { [key: string]: HtmlJson };
export interface HtmlBackendLink { kind: 'backend'; name: string; backendId: string; version: string }
/**
 * Which dataset API a link mounts in the page schema: `hasura`, the generated roots flattened at the top of the
 * page schema (`orders`, `orders_aggregate`, `insert_orders_one`…); `legacy`, the frozen generic namespace
 * (`orders { schema rows writeRows… }`). A stored link without the field is legacy (pages saved before the
 * generated API); publishing records it on every saved link (lib/artifacts `resolveDatasetApis`).
 */
export type HtmlDatasetApi = 'hasura' | 'legacy';
/** Archived pages explicitly keep live bindings live; pinned bindings always read their recorded revision. */
export type HtmlDatasetLink = { kind: 'dataset'; name: string; datasetId: string; api?: HtmlDatasetApi } &
  ({ mode: 'live' } | { mode: 'pinned'; revision: string });
/** The API a saved link mounts: absent is legacy. */
export const datasetLinkApi = (link: Pick<HtmlDatasetLink, 'api'>): HtmlDatasetApi => (link.api === 'hasura' ? 'hasura' : 'legacy');
export type HtmlPageLink = HtmlBackendLink | HtmlDatasetLink;
export interface HtmlPageVersion {
  pageId: string; version: number; revision: string; html: string;
  nextNodeId: number; links: readonly HtmlPageLink[];
}
export interface SaveHtmlPageRequest {
  pageId?: string; expectedRevision?: string; requestId: string; html: string;
  /** Named resolver TypeScript files, one per `<link rel="af-resolver">`. */
  resolverSources?: Readonly<Record<string, string>>;
}
/** Secret name to the one host that may receive it: exact, or one leading `*.` label. Never values. */
export type ResolverSecretHosts = Readonly<Record<string, string>>;
export interface HtmlPublicationReceipt { pageId: string; version: number; revision: string; created: boolean }
/** Instantiate A with original AccessActor. Do not reconstruct it from page-supplied principal fields. */
export interface HtmlPublication<A> {
  save(actor: A, input: SaveHtmlPageRequest, signal?: AbortSignal): Promise<HtmlPublicationReceipt>;
  read(actor: A, pageId: string, revision?: string): Promise<HtmlPageVersion>;
}
