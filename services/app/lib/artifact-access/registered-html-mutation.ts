import type {Queryable} from '@artifactbin/contracts';
/** Process-local proof, never serializable or accepted from public namespace arguments. */
const proofs=new WeakMap<object,{id:string;editId:string;verify:(tx:Queryable)=>Promise<void>}>();
/** Trusted registration host calls only after checking immutable persisted program bytes.
 * The callback MUST revalidate them under the owning transaction/page lock. */
export function attestRegisteredHtmlMutation(id:string,editId:string,verify:(tx:Queryable)=>Promise<void>):object {const proof=Object.freeze({});proofs.set(proof,{id,editId,verify});return proof;}
export async function verifyRegisteredHtmlMutation(document:{id:string;editId:string;registeredHtml?:object},tx:Queryable):Promise<boolean>{
 const value=document.registeredHtml&&proofs.get(document.registeredHtml);if(!value||value.id!==document.id||value.editId!==document.editId)return false;
 await value.verify(tx);return true;
}
