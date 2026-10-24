import type {Db} from '../../services/app/lib/platform/db';
import type {NativeHostContext,NativeHostRecipe,NativeHostComparison,NativeHostPrepared} from './native-migration-host-contract';
import type {NativeProductImportRecipe,NativeSerializedProductImportRecipe} from './native-migration-product-host-contract';
import type {NativeRuntimeAssembly,NativeRuntimePreparationOptions} from '../../services/app/lib/native-runtime-bridge/contracts';
import type {prepareNativeProductRuntime} from './native-migration-product-host';
import type {nativeProductPublicationModules} from './native-migration-bootstrap';
/** One bridge per converter, shared by every selected source; never a page-specific staging script. */
export interface NativeMigrationBootstrapOptions {
 db:Db;
 objectsDirectory:string;
 fixtureAuthSecret?:string;
 publication(input:{context:NativeHostContext;reviewedRecipe:NativeHostRecipe;files:Record<keyof NativeHostRecipe['inputs'],Uint8Array>;prepareRuntime(assemblies:readonly NativeRuntimeAssembly[],options:Omit<NativeRuntimePreparationOptions,'actor'|'origin'>):ReturnType<typeof prepareNativeProductRuntime>;publicationModules:typeof nativeProductPublicationModules}):Promise<NativeProductImportRecipe|NativeSerializedProductImportRecipe>;
 /** Existing gate owns browser/server lifecycle. Inject its actual camera, never fixture captures. */
 captureAndCompare(input:NativeHostContext&{imported:NativeHostPrepared;baselineRecipePath:string;candidateRecipePath:string}):Promise<NativeHostComparison>;
}
