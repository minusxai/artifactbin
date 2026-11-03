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
/** Secret name to the one host that may receive it: exact, or one leading `*.` label. Never values. */
export type ResolverSecretHosts = Readonly<Record<string, string>>;
