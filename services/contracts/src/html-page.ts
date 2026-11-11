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
/**
 * A LIVE DATASET (a dataset whose content is a database connection), linked like any dataset,
 * `<link rel="af-dataset" data-af-name="NAME" href="ref:ID">`: publish records it as this kind, always live (a
 * connection has no row revisions to pin).
 */
export interface HtmlLiveDatasetLink { kind: 'live-dataset'; name: string; datasetId: string }
export type HtmlPageLink = HtmlDatasetLink | HtmlDefaultConnectionLink | HtmlLiveDatasetLink;
/**
 * A DECLARED QUERY: `<script type="application/sql" data-af-query="NAME" data-af-dataset="LINK">SQL</script>` in the
 * published source, recorded by publish per page version (meta `htmlQueries`) after checking the publisher may edit
 * the live dataset `link` names. Readers run it by `name` (`sql.query(name, params)`), never by its text.
 */
export interface HtmlDeclaredQuery { name: string; link: string; sql: string }
export interface HtmlPageVersion {
  pageId: string; version: number; revision: string; html: string;
  nextNodeId: number; links: readonly HtmlPageLink[];
  /** The version's declared queries (meta `htmlQueries`). */
  queries: readonly HtmlDeclaredQuery[];
}
