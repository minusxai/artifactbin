import type {NativeAncillaryFolderRecipe} from '../../services/app/lib/native-ancillary-folders/contracts';
import type {Queryable} from '../../services/app/lib/platform/db';
import type {NativeHistoryImport} from '../../services/app/lib/native-history-import/contracts';
import type {NativeRelationProjection} from '../../services/app/lib/native-history-import/relation-contracts';
import type {NativeArtifactRelationsInput} from '../../services/app/lib/native-history-import/artifact-relation-contracts';
import type {NativeIdentityImport,NativeIdentityMigrationSchemas} from '../../services/app/lib/native-identity-import/contracts';
import type {NativeCatalogProjection} from '../../services/app/lib/native-history-import/catalog-contracts';
import type {canonicalNativeObjectSource} from '../../services/app/lib/native-history-import/catalog-source';
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
