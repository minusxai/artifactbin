import type {Queryable} from '@artifactbin/contracts';
/** Separate from registered SQL mutation authority; never accepted from a page. */
export interface SavedHtmlUploadDocument {id:string;editId:string;version:number;datasetId:string;uploadProof:object}
type Authority=Omit<SavedHtmlUploadDocument,'uploadProof'>;
const proofs=new WeakMap<object,{authority:Authority;verify:(tx:Queryable)=>Promise<void>}>();
/** File service alone mints after saved-link admission; callback rechecks under
 * its owning transaction. No proof is returned in an HTTP response. */
export function attestSavedHtmlUpload(authority:Authority,verify:(tx:Queryable)=>Promise<void>):object {
 const proof=Object.freeze({});proofs.set(proof,{authority:{...authority},verify});return proof;
}
export async function verifySavedHtmlUpload(document:SavedHtmlUploadDocument,datasetId:string,tx:Queryable):Promise<boolean> {
 const stored=proofs.get(document.uploadProof);
 if(!stored||document.datasetId!==datasetId||(['id','editId','version','datasetId'] as const).some(key=>document[key]!==stored.authority[key]))return false;
 await stored.verify(tx);return true;
}
