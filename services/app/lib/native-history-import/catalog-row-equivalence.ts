import {nativeCatalogDigest} from './catalog-digest';
import type {NativeCatalogRowEquivalence} from './catalog-contracts';
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
/** Catalog source manifests cover the complete export, rather than one dataset.
 * Permit only that provenance difference after every dataset-local identity and
 * every ordinary row field compares exactly. Never mutate stored provenance. */
export function compareNativeCatalogRows(stored:Record<string,unknown>,incoming:Record<string,unknown>):NativeCatalogRowEquivalence {
 if(nativeCatalogDigest(stored)===nativeCatalogDigest(incoming))return {equal:true};
 const a=stored.meta,b=incoming.meta;
 if(!record(a)||!record(b)||!record(a.nativeCatalogImport)||!record(b.nativeCatalogImport))return {equal:false};
 const ai=a.nativeCatalogImport,bi=b.nativeCatalogImport;
 for(const i of [ai,bi])if(!['selectionSha256','sourceManifestSha256','objectManifestSha256','datasetProjectionSha256','datasetSourceSha256','versionSourceSha256'].every(k=>hash(i[k])))return {equal:false};
 const {sourceManifestSha256:oldManifest,...oldIdentity}=ai,{sourceManifestSha256:newManifest,...newIdentity}=bi;
 if(nativeCatalogDigest(oldIdentity)!==nativeCatalogDigest(newIdentity))return {equal:false};
 const canonical={...incoming,meta:{...b,nativeCatalogImport:{...bi,sourceManifestSha256:oldManifest}}};
 if(nativeCatalogDigest(stored)!==nativeCatalogDigest(canonical))return {equal:false};
 return {equal:true,provenance:{storedSourceManifestSha256:oldManifest as string,incomingSourceManifestSha256:newManifest as string,datasetProjectionSha256:ai.datasetProjectionSha256 as string}};
}
