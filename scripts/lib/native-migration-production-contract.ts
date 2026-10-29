import type { Db, Queryable } from '../../services/app/lib/platform';
import type {S3Config} from '../../services/app/lib/object-store';
import type {NativeImmutableObjectSink} from '../../services/app/lib/native-history-import';
import type {NativeHostFile,NativeHostKey} from './native-migration-host-contract';
import type {NativeMigrationBootstrapOptions} from './native-migration-bootstrap-contract';
import type {NativeIdentityImport} from '../../services/app/lib/native-identity-import';
import type {NativeAncillaryFolderRecipe} from '../../services/app/lib/native-ancillary-folders';
import type {prepareNativeProductImport} from './native-migration-product-host';
/** Private operator input. Connection strings and credentials never belong in this plan. */
export interface NativeProductionPlan {
 format:'native-production-plan-v1';revisionScope:'latest';sourceNamespace:string;
 selectionManifest:NativeHostFile;datasetCensus:NativeHostFile;identity:NativeHostFile;ancillaryFolders?:NativeHostFile;
 runtimeAuthority?:{mode:'scoped-internal-tokens';ttlMs:number};
 heads:readonly {key:NativeHostKey;canonicalSha256:string}[];
 batches:readonly {id:string;sourceIds:readonly string[]}[];
 target:{appSchema:string;authSchema:string;bucketSha256:string;objectPrefix:string;originSha256:string;protectedSchemas:readonly string[];protectedObjects:readonly {bucketSha256:string;prefix:string}[]};
 sha256:string;
}
/** Execution batches are disjoint subsets of the immutable global 393/190 scope. */
export interface NativeProductionBatch {
 format:'native-production-batch-v1';id:string;planSha256:string;batchSourceIds:readonly string[];
 heads:readonly {sourceId:string;context:NativeHostFile;imported:NativeHostFile;comparison:NativeHostFile;reviewedDecision?:NativeHostFile}[];
 sha256:string;
}
/** @public Reviewed operator lifecycle boundary. */
export interface NativeProductionTarget {
 db:Db;s3:S3Config;runtimeStorage:{bucket:string;prefix:string};origin:string;
 publication:NativeMigrationBootstrapOptions['publication'];
 close():Promise<void>;
}
/** Provider and injection seams are host-only. Defaults use actual product transactions and conditional S3. */
export interface NativeProductionOptions {
 approvedReviewedDecisionSha256?:readonly string[];
 decodeContext?:(wire:unknown)=>import('./native-migration-host-contract').NativeHostContext;
 planPath:string;batchPath:string;receiptRoot:string;outputDirectory:string;
 apply?:boolean;approvedPlanSha256?:string;
 openTarget(plan:NativeProductionPlan):Promise<NativeProductionTarget>;
 runtimeBinding?:{db:Db|Promise<Db>;storage:{bucket:string;prefix:string};backend:'s3'|'local'};
 tokenAuthority?:{mint(tx:Queryable,userId:string,ttlMs:number):Promise<string>;revoke(id:string):Promise<void>};
 sinkFactory?:(config:S3Config)=>NativeImmutableObjectSink;
 prepareImport?:typeof prepareNativeProductImport;
 preparePrerequisites?:(tx:Queryable,identity:NativeIdentityImport,folders:NativeAncillaryFolderRecipe|undefined,schemas:{appSchema:string;authSchema:string})=>Promise<unknown>;
}
