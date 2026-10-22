import type {CompiledMermaidPlan} from './mermaid-contracts.ts';
/** The measured host must remain the exact initially present source figure. */
export function reconcileMermaidHtml(fragment:unknown,plans:readonly CompiledMermaidPlan[],deck=false):boolean{
 const hosts:any[]=[],previews:any[]=[];
 const attr=(n:any,k:string)=>n.attrs?.find((a:any)=>a.name===k)?.value;
 const text=(n:any):string=>n.nodeName==='#text'?n.value:(n.childNodes??[]).map(text).join('');
 const walk=(n:any,inRail=false)=>{const rail=inRail||(attr(n,'class')??'').split(/\s+/).includes('mx-rail');if(attr(n,'data-mx-mermaid-state')!==undefined)(rail?previews:hosts).push(n);for(const c of n.childNodes??[])walk(c,rail);if(n.content)walk(n.content,rail);};walk(fragment);
 const encoded=(v:string)=>[...v].map(c=>c.codePointAt(0)!.toString(16).padStart(6,'0')).join('');
 if(previews.some(n=>!deck||n.tagName!=='figure'||attr(n,'data-mx-mermaid-state')!=='pending'||!plans.some(p=>new RegExp('^mx-preview-'+encoded('_R_1_')+'-(?:00003[0-9])+(?:00002e(?:00003[0-9])+)*-'+encoded(p.id)+'(?:-[1-9][0-9]*)?$').test(attr(n,'id')??'')&&n.childNodes.some((c:any)=>c.tagName==='figcaption'&&text(c)===(p.title??'Diagram')))))return false;
 return hosts.length===plans.length&&plans.every(plan=>{
  const selected=hosts.filter(n=>attr(n,'id')===plan.id);
  if(selected.length!==1||selected[0].tagName!=='figure'||attr(selected[0],'data-mx-mermaid-state')!=='pending')return false;
  const captions=selected[0].childNodes.filter((n:any)=>n.tagName==='figcaption');
  return captions.length===1&&text(captions[0])===(plan.title??'Diagram');
 });
}
