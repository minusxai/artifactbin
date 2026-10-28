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
  backendSources?: Readonly<Record<string, string>>;
}
export interface HtmlPublicationReceipt { pageId: string; version: number; revision: string; created: boolean }
/** Instantiate A with original AccessActor. Do not reconstruct it from page-supplied principal fields. */
export interface HtmlPublication<A> {
  save(actor: A, input: SaveHtmlPageRequest, signal?: AbortSignal): Promise<HtmlPublicationReceipt>;
  read(actor: A, pageId: string, revision?: string): Promise<HtmlPageVersion>;
}
