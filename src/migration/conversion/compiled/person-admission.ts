import {validBoundValueProof} from './bound-value-proof.ts';
import {validCompiledPersonBindings} from './person-binding.ts';
import type {BoundValueColumnProof} from './bound-value-contracts.ts';
import type {CompiledDatasetBinding} from './dataset-contracts.ts';
import type {CompiledPersonBinding} from './person-contracts.ts';
/** Offline facts must name the same imported column and immutable provenance.
 * Runtime profile policy remains server-owned and freshly evaluated. */
export function validateBoundPersonRouting(proofs:readonly BoundValueColumnProof[],datasets:readonly CompiledDatasetBinding[],people:readonly CompiledPersonBinding[]):boolean {
 return Array.isArray(proofs)&&proofs.length<=256&&proofs.every(p=>validBoundValueProof(p)&&datasets.some(b=>b.name===p.bindingName&&b.legacyRef===p.sourceRef&&b.version===p.version&&b.backendNamespace==='legacyData'&&b.tables.some(t=>t.schema===p.schema&&t.table===p.table&&t.columns.some(c=>c.name===p.column&&c.type==='user'))))&&new Set(proofs.map(p=>p.valueName)).size===proofs.length&&validCompiledPersonBindings(people)&&people.every(p=>proofs.some(v=>v.valueName===p.valueName));
}
/** Only a selected, source-bound Value reaches the card API; no arbitrary IDs. */
export function admitPersonAttributes(attrs:Readonly<Record<string,unknown>>,hasChildren:boolean):string {
 if(hasChildren)throw Error('Person children unsupported');
 for(const [key,value]of Object.entries(attrs)){
  if(['id','className','fallback'].includes(key)){if(typeof value!=='string'||value.length>4096)throw Error('Static person text required');}
  else if(['avatar','link'].includes(key)){if(typeof value!=='boolean')throw Error('Literal person flag required');}
  else if(key!=='userId')throw Error('Unsupported person prop');
 }
 if(typeof attrs.userId!=='string'||!/^\$[A-Za-z][A-Za-z0-9_]*$/.test(attrs.userId)||['constructor','prototype','__proto__'].includes(attrs.userId.slice(1)))throw Error('Bound person Value required');
 return attrs.userId.slice(1);
}
