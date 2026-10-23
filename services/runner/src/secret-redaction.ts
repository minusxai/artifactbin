import type {RunnerJson} from '@artifactbin/contracts';
/** Literal credential redaction at durable platform boundaries, scoped to one run. */
export function redactRunSecrets(value:RunnerJson,secrets:ReadonlySet<string>):RunnerJson{
 const names=[...secrets].filter(Boolean).sort((a,b)=>b.length-a.length);
 const pattern=names.length?new RegExp(names.map(name=>name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g'):null;
 const text=(value:string)=>pattern?value.replace(pattern,'[redacted]'):value;
 function visit(value:RunnerJson):RunnerJson{if(typeof value==='string')return text(value);if(Array.isArray(value))return value.map(visit);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,value])=>[text(key),visit(value)]));return value;}
 return visit(value);
}
