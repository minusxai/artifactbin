import type {NativeHostContext,NativeHostRecipe,NativeHostFiles} from './native-migration-host-contract';
import type {NativeProductionPlan} from './native-migration-production-contract';
/** Authority transformation preserves all source evidence; it makes no import or comparison claim. */
export interface NativeProductionAuthorityInput {
 context:NativeHostContext;recipe:NativeHostRecipe;files:NativeHostFiles;
 plan:NativeProductionPlan;globalIdentity:Uint8Array;globalAncillary?:Uint8Array;origin:string;
}
export interface NativeProductionAuthorityPrepared {
 recipe:NativeHostRecipe;files:NativeHostFiles;
 diff:{format:'native-production-authority-diff-v1';planSha256:string;key:NativeHostRecipe['key'];assemblySha256:string;
 preservedInputSha256:Readonly<Record<string,string>>;
 schemas:{before:{appSchema:string;authSchema:string};after:{appSchema:string;authSchema:string}};
 origin:{beforeSha256:string;afterSha256:string};
 actor:{userId:string;previousTokenIdSha256:string|null;previousRuntimeMode:string|null;afterAuthority:'scoped-internal-tokens';ttlMs:number};
 sourceAndTargetRevisionsPreserved:true;imported:false;comparisonAdmitted:false;productionWrites:0};
}
