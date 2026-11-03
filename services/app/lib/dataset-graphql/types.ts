import type { AccessActor } from '@/lib/accounts';
import type { ArtifactRow } from '@/lib/artifacts';
import type { CatalogRowView, DatasetCatalog } from '@/lib/datasets';
import type { DatasetRole, HtmlDatasetLink, Scalar } from '@artifactbin/contracts';
import type { HasuraTableNames } from './hasura-names';
export interface DatasetRowIdentitySidecar {objectKey:string;ids:readonly string[]}
/** Authorized, revision-specific data. Policy identity changes invalidate cursors. */
export interface DatasetSnapshot {
 id:string; revision:string; policyIdentity:string; catalog:DatasetCatalog;
 rowIds:Readonly<Record<string,readonly string[]>>;
 /** The reader's role view (lib/dataset-permissions), or null when it shows every row (owner, editor, a whole rule). */
 view?:CatalogRowView|null;
 /** Per table: may this role run aggregate queries (the select rule's allow_aggregations; owner and editor always). */
 aggregatable?:Readonly<Record<string,boolean>>;
 /** The role the view was decided for (lib/dataset-permissions `datasetRole`). */
 role?:DatasetRole;
 /** The dataset head the read was authorized on (a pinned link's too): the write decision reads it rather than again. */
 head?:ArtifactRow;
 /** Per table: the generated GraphQL root and column names (lib/dataset-graphql/hasura-names), for every declared table. */
 names?:Readonly<Record<string,HasuraTableNames>>;
}
export interface DatasetStatement { sql:string; params:Record<string,Scalar> }
/** Narrow port to the retained dataset executor, ACL and object storage; writes go through hasura.ts's mutation door. */
export interface DatasetGraphqlPort {
 snapshot(actor:AccessActor,binding:HtmlDatasetLink,signal:AbortSignal):Promise<DatasetSnapshot>;
 execute(actor:AccessActor,snapshot:DatasetSnapshot,tableId:string,statement:DatasetStatement,window:{limit:number;offset:number},signal:AbortSignal):Promise<Record<string,unknown>[]>;
}
