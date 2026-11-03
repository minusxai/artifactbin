import type {RunReceipt} from '@artifactbin/contracts';
import {boundedDetail} from './contracts';
/** The value, its URL-encoded and base64 forms, longest first so a longer form is never half-replaced. */
export function secretForms(values:readonly string[]):string[]{
 const forms=new Set<string>();
 for(const v of values){const b=Buffer.from(v);for(const f of [v,encodeURIComponent(v),b.toString('base64'),b.toString('base64').replace(/=+$/,''),b.toString('base64url')])if(f)forms.add(f);}
 return [...forms].sort((a,b)=>b.length-a.length);
}
export const redact=(text:string,forms:readonly string[])=>forms.reduce((t,f)=>t.split(f).join('[redacted]'),text);
const URL_TOKEN=/\bhttps?:\/\/[^\s"'<>`]+/gi;
const CREDENTIAL=/\b(?:bearer|basic)\s+[^\s,;]+/gi;
/** Credential-bearing header values (`name: value`) and credential-named parameters (`key=value`). */
const HEADER_VALUE=/\b(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key|x-auth-token|x-goog-api-key)(\s*[:=]\s*)[^\s,;]+|\b(\w*(?:token|key|secret|password|signature)\w*)(=)[^\s&,;]+/gi;
const withoutQuery=(raw:string)=>{try{const u=new URL(raw);return `${u.protocol}//${u.host}${u.pathname}`;}catch{return '[url]';}};
/**
 * A resolver's reason made safe to show: secret values (every encoded form) are redacted from the whole text
 * before anything is cut; URL queries, fragments and userinfo, credentials and header values are dropped, and only
 * the first line is kept (≤200 characters), so a stack never leaves.
 */
export function redactedLine(text:string,secrets:readonly string[]=[]):string|undefined{
 const line=redact(text,secretForms(secrets)).split(/\r?\n/,1)[0]!;
 return boundedDetail(line.replace(URL_TOKEN,withoutQuery).replace(CREDENTIAL,m=>`${m.split(/\s/,1)[0]} [redacted]`).replace(HEADER_VALUE,(_m,header?:string,sep?:string,param?:string,eq?:string)=>`${header??param}${sep??eq}[redacted]`));
}
/**
 * The owner-only detail of a failed resolver run: what it threw (or the runner's refusal code), with the
 * upstream HTTP status it threw on, redacted by `redactedLine`.
 */
export function resolverFailureDetail(receipt:Pick<RunReceipt,'reason'|'requests'>|null|undefined,secrets:readonly string[]=[]):string|undefined{
 if(!receipt||typeof receipt.reason!=='string')return undefined;
 const message=redactedLine(receipt.reason,secrets);
 const last=Array.isArray(receipt.requests)?receipt.requests.filter(r=>r.service==='fetch').at(-1):undefined;
 const status=last&&typeof last.status==='number'&&(last.status<200||last.status>299)?`HTTP ${last.status}`:undefined;
 return boundedDetail([status,message].filter(Boolean).join(': '));
}
