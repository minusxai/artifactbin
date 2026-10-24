import {createHash} from 'node:crypto';
export interface NativeResourceFile {path:string;bytes:Uint8Array;sha256:string}
export interface NativeResourceAsset {sources:readonly string[];bytes:Uint8Array;sha256:string;extension:string;provenanceSha256:string}
export interface NativeResourceReceipt {source:string;target:string;sha256:string}
export interface NativeResourceClosure {files:NativeResourceFile[];urls:NativeResourceReceipt[];external:string[];missing:string[]}
export const resourceSha256=(bytes:string|Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
const digest=(v:string)=>/^[a-f0-9]{64}$/.test(v);
function cssReferences(css:string):{start:number;end:number;source:string}[]{
 const out:{start:number;end:number;source:string}[]=[];
 const decode=(value:string)=>value.replace(/\\([a-f0-9]{1,6})\s?|\\([^\r\n])/gi,(_all,hex:string|undefined,char:string|undefined)=>hex?String.fromCodePoint(parseInt(hex,16)):char??'');
 const quoted=(i:number)=>{const quote=css[i++]!,start=i;for(;i<css.length;i++){if(css[i]==='\\'){i++;continue;}if(css[i]===quote)return {start,end:i,next:i+1};}throw Error('Unterminated CSS string');};
 for(let i=0;i<css.length;){
  if(css.slice(i,i+2)==='/*'){const end=css.indexOf('*/',i+2);if(end<0)throw Error('Unterminated CSS comment');i=end+2;continue;}
  if(css.slice(i,i+7).toLowerCase()==='@import'&&!/[\w-]/.test(css[i+7]??'')){let j=i+7;while(/\s/.test(css[j]??'')&&j<css.length)j++;if(css[j]==='"'||css[j]==="'"){const q=quoted(j);out.push({...q,source:decode(css.slice(q.start,q.end))});i=q.next;continue;}}
  if(css.slice(i,i+4).toLowerCase()==='url('&&!/[\w-]/.test(css[i-1]??'')){
   let j=i+4;while(/\s/.test(css[j]??'')&&j<css.length)j++;
   if(css[j]==='"'||css[j]==="'"){const q=quoted(j);out.push({...q,source:decode(css.slice(q.start,q.end))});i=q.next;continue;}
   const start=j;for(;j<css.length;j++){if(css[j]==='\\'){j++;continue;}if(css[j]===')')break;}
   if(j===css.length)throw Error('Unterminated CSS URL');let end=j;while(end>start&&/\s/.test(css[end-1]!))end--;out.push({start,end,source:decode(css.slice(start,end))});i=j+1;continue;
  }
  if(css[i]==='"'||css[i]==="'"){i=quoted(i).next;continue;}i++;
 }
 return out;
}
export function rewriteNativeCss(css:string,urls:readonly NativeResourceReceipt[]):{css:string;urls:string[]} {
 const references=cssReferences(css);let result='',offset=0;
 for(const ref of references){const mapped=urls.find(value=>value.source===ref.source);result+=css.slice(offset,ref.start)+(mapped?mapped.target:css.slice(ref.start,ref.end));offset=ref.end;}
 return {css:result+css.slice(offset),urls:[...new Set(references.map(ref=>ref.source))]};
}
export function closeNativeResources(sources:readonly string[],assets:readonly NativeResourceAsset[]):NativeResourceClosure {
 const lookup=new Map<string,NativeResourceAsset>();
 for(const asset of assets){if(!digest(asset.provenanceSha256)||asset.sha256!==resourceSha256(asset.bytes)||!/^[a-z0-9]{1,8}$/.test(asset.extension))throw Error('Resource digest or extension invalid');for(const source of asset.sources){const prior=lookup.get(source);if(prior&&prior.sha256!==asset.sha256)throw Error('Resource source has ambiguous archived versions');lookup.set(source,asset);}}
 const files=new Map<string,NativeResourceFile>(),urls:NativeResourceReceipt[]=[],external:string[]=[],missing:string[]=[];
 for(const source of new Set(sources)){
  const asset=lookup.get(source);
  if(asset){const file=`assets/${asset.sha256}.${asset.extension}`;files.set(file,{path:file,bytes:asset.bytes,sha256:asset.sha256});urls.push({source,target:'./'+file,sha256:asset.sha256});}
  else if(source.startsWith('#')||source.startsWith('data:')||!source)continue;
  else if(/^(?:https?:|mailto:|tel:|\/\/)/i.test(source)){external.push(source);urls.push({source,target:source,sha256:resourceSha256(source)});}
  else missing.push(source);
 }
 return {files:[...files.values()],urls,external,missing};
}
