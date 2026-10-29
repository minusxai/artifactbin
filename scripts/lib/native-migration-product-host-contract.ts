import type {NativeAncillaryFolderRecipe} from '../../services/app/lib/native-ancillary-folders';
import type { Queryable } from '../../services/app/lib/platform';
import type {NativeHistoryImport, NativeRelationProjection, NativeArtifactRelationsInput, NativeCatalogProjection, canonicalNativeObjectSource} from '../../services/app/lib/native-history-import';
import type {NativeIdentityImport,NativeIdentityMigrationSchemas} from '../../services/app/lib/native-identity-import';
/** Converter-produced projections are private inputs, never inferred from page names or IDs. */
export interface NativeProductImportRecipe {
 revisionScope:'latest';history:NativeHistoryImport;
 relations:NativeRelationProjection;
 membership:NativeArtifactRelationsInput;
 identity:NativeIdentityImport;
 /** Explicit reviewed mapping for pre-existing group identities; no inferred or created groups. */
 identityGroups?:Readonly<Record<string,string>>;
 ancillaryFolders?:NativeAncillaryFolderRecipe;
 schemas:NativeIdentityMigrationSchemas;
 catalog:{projection:NativeCatalogProjection;root:string;ledgerPath:string;receipts:Parameters<typeof canonicalNativeObjectSource>[2];sinkDirectory:string};
}
export interface NativeProductImportDb {
 transaction<T>(work:(tx:Queryable)=>Promise<T>):Promise<T>;
}

interface NativeHostEncodedBytes {encoding:'base64';data:string;sha256:string}
export type NativeSerializedProductImportRecipe=Omit<NativeProductImportRecipe,'membership'>&{
 membership:Omit<NativeArtifactRelationsInput,'source'>&{source:{
  capture:NativeHostEncodedBytes;selectionManifest:NativeHostEncodedBytes;canonicalSource:NativeHostEncodedBytes;headWitness:NativeHostEncodedBytes;refreshManifest?:NativeHostEncodedBytes;
 }};
};
