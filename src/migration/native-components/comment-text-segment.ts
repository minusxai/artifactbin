import {parse} from "parse5";
import type {DefaultTreeAdapterTypes} from "parse5";
import type {NativePublicationCommentSegment} from "./pipeline-publication-contracts.ts";
export interface NativeCommentTextSelection {html:string;nodeId:string;sourceNodeId:string;legacyRange:unknown;}
/** Narrow legacy single-node range projection. Unsupported or ambiguous evidence stays unprojected. */
export function nativeCommentTextSegment(input:NativeCommentTextSelection):readonly NativePublicationCommentSegment[]|undefined {
 let raw:unknown=input.legacyRange;try{if(typeof raw==='string')raw=JSON.parse(raw);}catch{return;}
 if(!raw||typeof raw!=='object'||Array.isArray(raw))return;
 const r=raw as {v?:unknown;parts?:unknown};if(r.v!==1||!Array.isArray(r.parts)||r.parts.length!==1)return;
 const part=r.parts[0] as Record<string,unknown>|null;
 if(!part||typeof part!=='object'||part.rel!==''||typeof part.text!=='string'||!part.text.trim()||!Number.isSafeInteger(part.start)||!Number.isSafeInteger(part.end)||Number(part.start)<0||Number(part.end)<=Number(part.start))return;
 const nodes:DefaultTreeAdapterTypes.Element[]=[];
 const visit=(n:DefaultTreeAdapterTypes.Node):void=>{if('attrs'in n&&n.attrs.some(a=>a.name==='data-af-id'&&a.value===input.nodeId))nodes.push(n);if('childNodes'in n)for(const c of n.childNodes)visit(c);};visit(parse(input.html));if(nodes.length!==1)return;
 let text='';const collect=(n:DefaultTreeAdapterTypes.Node):void=>{if(n.nodeName==='#text'&&'value'in n)text+=n.value;if('childNodes'in n)for(const c of n.childNodes)collect(c);};collect(nodes[0]!);
 let canonical='';const positions:number[]=[];let pending:number|undefined;
 for(let i=0;i<text.length;i++){if(/\s/.test(text[i]!)){if(canonical&&pending===undefined)pending=i;continue;}if(pending!==undefined){canonical+=' ';positions.push(pending);pending=undefined;}canonical+=text[i];positions.push(i);}
 const quote=part.text.replace(/\s+/g,' ').trim();if(quote!==part.text)return;const at=canonical.indexOf(quote);if(at<0||canonical.indexOf(quote,at+1)>=0)return;
 const start=positions[at]!,end=positions[at+quote.length]??(positions[positions.length-1]!+1);
 let hash=2166136261;for(let i=0;i<text.length;i++)hash=Math.imul(hash^text.charCodeAt(i),16777619);
 return [{sourceNodeId:input.sourceNodeId,quote:part.text,endAffinity:'forward',range:{start,end,length:text.length,fingerprint:(hash>>>0).toString(16).padStart(8,'0')}}];
}
