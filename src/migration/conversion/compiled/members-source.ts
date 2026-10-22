import{analyzeLegacyBuiltin}from './builtin-source.ts';
import type{LegacyMutationImportCatalog}from '../mutation-contracts.ts';
/** Offline physical relation detection, never authored substring inference. */
export async function readsLegacyMembers(source:string,catalogs:readonly LegacyMutationImportCatalog[]=[]):Promise<boolean>{
 try{return await analyzeLegacyBuiltin(source,'_members',catalogs);}catch{return false;}
}
