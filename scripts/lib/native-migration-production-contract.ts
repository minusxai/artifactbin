import type {Db} from '../../services/app/lib/platform/db';
import type {S3Config} from '../../services/app/lib/object-store';
import type {NativeImmutableObjectSink} from '../../services/app/lib/native-history-import/catalog-contracts';
import type {NativeHostFile,NativeHostKey} from './native-migration-host-contract';
import type {NativeMigrationBootstrapOptions} from './native-migration-bootstrap-contract';
import type {NativeIdentityImport} from '../../services/app/lib/native-identity-import/contracts';
import type {Queryable} from '../../services/app/lib/platform/db';
import type {NativeAncillaryFolderRecipe} from '../../services/app/lib/native-ancillary-folders/contracts';
import type {prepareNativeProductImport} from './native-migration-product-host';
/** Private operator input. Connection strings and credentials never belong in this plan. */
export interface NativeProductionPlan {
 format:'native-production-plan-v1';revisionScope:'latest';sourceNamespace:string;
 selectionManifest:NativeHostFile;datasetCensus:NativeHostFile;identity:NativeHostFile;ancillaryFolders?:NativeHostFile;
 heads:readonly {key:NativeHostKey;canonicalSha256:string}[];
 batches:readonly {id:string;sourceIds:readonly string[]}[];
 target:{appSchema:string;authSchema:string;bucketSha256:string;objectPrefix:string;originSha256:string;protectedSchemas:readonly string[];protectedObjects:readonly {bucketSha256:string;prefix:string}[]};
 sha256:string;
}
/** Execution batches are disjoint subsets of the immutable global 393/190 scope. */
export interface NativeProductionBatch {
 format:'native-production-batch-v1';id:string;planSha256:string;batchSourceIds:readonly string[];
 heads:readonly {sourceId:string;context:NativeHostFile;imported:NativeHostFile;comparison:NativeHostFile}[];
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
 planPath:string;batchPath:string;receiptRoot:string;outputDirectory:string;
 apply?:boolean;approvedPlanSha256?:string;
 openTarget(plan:NativeProductionPlan):Promise<NativeProductionTarget>;
 runtimeBinding?:{db:Db|Promise<Db>;storage:{bucket:string;prefix:string};backend:'s3'|'local'};
 sinkFactory?:(config:S3Config)=>NativeImmutableObjectSink;
 prepareImport?:typeof prepareNativeProductImport;
 preparePrerequisites?:(tx:Queryable,identity:NativeIdentityImport,folders:NativeAncillaryFolderRecipe|undefined,schemas:{appSchema:string;authSchema:string})=>Promise<unknown>;
}
