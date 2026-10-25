import type {Db} from '../../services/app/lib/platform/db';
import type {NativeHostContext,NativeHostRecipe,NativeHostFiles,NativeHostComparison,NativeHostPrepared} from './native-migration-host-contract';
import type {NativeProductImportRecipe,NativeSerializedProductImportRecipe} from './native-migration-product-host-contract';
import type {NativeRuntimeAssembly,NativeRuntimePreparationOptions} from '../../services/app/lib/native-runtime-bridge/contracts';
import type {prepareNativeProductRuntime} from './native-migration-product-host';
import type {nativeProductPublicationModules} from './native-migration-bootstrap';
/** One bridge per converter, shared by every selected source; never a page-specific staging script. */
export interface NativeMigrationBootstrapOptions {
 db:Db;
 runtimeActors?:import("./native-migration-disposable-actors-contract").NativeDisposableRuntimeActorPort;
 objectsDirectory:string;
 fixtureAuthSecret?:string;
 publication(input:{context:NativeHostContext;reviewedRecipe:NativeHostRecipe;files:NativeHostFiles;prepareRuntime(assemblies:readonly NativeRuntimeAssembly[],options:Omit<NativeRuntimePreparationOptions,'actor'|'origin'>):ReturnType<typeof prepareNativeProductRuntime>;publicationModules:typeof nativeProductPublicationModules}):Promise<NativeProductImportRecipe|NativeSerializedProductImportRecipe>;
 /** Existing gate owns browser/server lifecycle. Inject its actual camera, never fixture captures. */
 captureAndCompare(input:NativeHostContext&{imported:NativeHostPrepared;baselineRecipePath:string;candidateRecipePath:string}):Promise<NativeHostComparison>;
}

/** A committed actual import with no database dump, candidate bundle, or camera claim. */
export interface NativeMigrationImportOnlyResult {
 stage:'imported-unsnapshotted';
 key:NativeHostContext['revision']['key'];assemblySha256:string;historyProjectionSha256:string;
 importResult:NonNullable<NativeHostPrepared['importResult']>;
 history:Awaited<ReturnType<typeof import('./native-migration-product-host').prepareNativeProductImport>>['history'];
 identityPlan:NativeProductImportRecipe['identity']['plan'];datasetIds:readonly string[];
 reviewedRecipe:NativeHostRecipe;
 identityPreparation:{transaction:'separate-prerequisite';identityPlanSha256:string;identities:NonNullable<NativeHostPrepared['importResult']>['identities']};
 identityPreparationPath:string;
}
