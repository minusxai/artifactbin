import {parse} from 'parse5';
import type {DefaultTreeAdapterTypes} from 'parse5';
import type {MigrationMaps} from './contracts.ts';
/** Rewrites only structural hyperlinks addressed to the explicitly supplied legacy origins. */
export function rewriteMigrationLinks(html:string,maps:MigrationMaps,options:{legacyOrigins:readonly string[];targetOrigin:string}):string {
 const document=parse(html,{sourceCodeLocationInfo:true});const edits:{start:number;end:number;text:string}[]=[];
 const walk=(node:DefaultTreeAdapterTypes.Node)=>{
  if('attrs' in node){const attr=node.attrs.find(a=>a.name==='href');const location=node.sourceCodeLocation?.attrs?.href;
   if(attr&&location){
    const value=attr.value;const absolute=/^(?:https?:)?\/\//i.test(value);let url:URL|null=null;
    try{url=new URL(value,'https://relative.invalid');}catch{}
    const allowed=url&&(!absolute&&url.origin==='https://relative.invalid'||options.legacyOrigins.some(origin=>new URL(origin).origin===url!.origin));
    const match=url?.pathname.match(/^\/(?:a\/|@[a-zA-Z0-9-]+\/)([a-zA-Z0-9]+)(\/?$)/);
    const reference=value.match(/^ref:([a-zA-Z0-9]+)$/);const oldId=reference?.[1]??match?.[1];const id=oldId?maps.pages[oldId]:undefined;
    if(id&&(reference||allowed&&match)){
     const path=reference?'/a/'+id:url!.pathname.replace(oldId!,id)+url!.search+url!.hash;
     const href=absolute?new URL(path,options.targetOrigin).href:path;
     edits.push({start:location.startOffset,end:location.endOffset,text:'href="'+href.replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"'});
    }
   }
  }
  if('childNodes' in node)for(const child of node.childNodes)walk(child);
 };
 walk(document);for(const edit of edits.sort((a,b)=>b.start-a.start))html=html.slice(0,edit.start)+edit.text+html.slice(edit.end);return html;
}
