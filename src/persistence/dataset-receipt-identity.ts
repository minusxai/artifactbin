import {createHash} from 'node:crypto';
import {canonical} from '../model-values.ts';
import type {Json} from '../contracts.ts';
import type {VisualReceiptIdentity} from '../datasets/receipt-identity-contracts.ts';
import type {DatasetMutationOperation} from '../datasets/mutation/contracts.ts';
import type {DatasetAttachmentRegistration} from '../datasets/attachments/contracts.ts';
type Descriptor = {receiptIdentity?:VisualReceiptIdentity};
const hash=(value:unknown)=>createHash('sha256').update(canonical(value as Json)).digest('hex');
function original<T extends Descriptor>(value:T,page:(value:T)=>{version:number}):T|null{
 try {
 const copy=JSON.parse(JSON.stringify(value)) as T,identity=copy.receiptIdentity;
 if(identity===undefined)return copy;
 if(!identity||Object.keys(identity).sort().join(',')!=='descriptorSha256,kind,pageVersion'||identity.kind!=='visual-revision-receipt-v1'||!Number.isSafeInteger(identity.pageVersion)||identity.pageVersion<1||identity.pageVersion>=page(copy).version||!/^[a-f0-9]{64}$/.test(identity.descriptorSha256))return null;
 delete copy.receiptIdentity;page(copy).version=identity.pageVersion;
 return hash(copy)===identity.descriptorSha256?copy:null;
 } catch {return null;}
}
function seal<T extends Descriptor>(value:T,version:number,page:(value:T)=>{version:number}):T{
 const source=original(value,page);
 if(!source||!Number.isSafeInteger(version)||version<=page(value).version)throw Error('Invalid visual receipt alias');
 const next=JSON.parse(JSON.stringify(value)) as T;
 page(next).version=version;
 next.receiptIdentity={kind:'visual-revision-receipt-v1',pageVersion:page(source).version,descriptorSha256:hash(source)};
 return next;
}
/** Receipt identity only; current-version authority and policy always use the live descriptor. */
export const canonicalMutationReceiptOperation=(value:DatasetMutationOperation)=>original(value,v=>v.page);
export const canonicalAttachmentReceiptRegistration=(value:DatasetAttachmentRegistration)=>original(value,v=>v.binding.page);
/** Trusted offline append ports. Ordinary publication rejects receiptIdentity instead of carrying it forward. */
export const sealMutationReceiptIdentity=(value:DatasetMutationOperation,version:number)=>seal(value,version,v=>v.page);
export const sealAttachmentReceiptIdentity=(value:DatasetAttachmentRegistration,version:number)=>seal(value,version,v=>v.binding.page);
