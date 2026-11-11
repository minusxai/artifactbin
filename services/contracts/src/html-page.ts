import type { ReviewJson } from './comment-view-state';
/** Immutable page versions, independent of the application's original actor/ACL model. */
export type HtmlJson = ReviewJson;
export type HtmlJsonObject = { [key: string]: HtmlJson };
/** Archived pages explicitly keep live bindings live; pinned bindings always read their recorded revision. */
export type HtmlDatasetLink = { kind: 'dataset'; name: string; datasetId: string } &
  ({ mode: 'live' } | { mode: 'pinned'; revision: string });
/**
 * The install's default connection, linked as `<link rel="af-dataset" data-af-name="NAME" href="default:NAMESPACE">`:
 * no artifact, no revision. `namespace` is the text after the colon ('' for none): the connector's schema, database or
 * dataset (contracts `ConnectorSpec.namespace`).
 */
export interface HtmlDefaultConnectionLink { kind: 'default-connection'; name: string; namespace: string }
export type HtmlPageLink = HtmlDatasetLink | HtmlDefaultConnectionLink;
export interface HtmlPageVersion {
  pageId: string; version: number; revision: string; html: string;
  nextNodeId: number; links: readonly HtmlPageLink[];
}
