import {parseFragment,serialize} from 'parse5';
import {parse,walk} from 'css-tree';
import type {MermaidPreparationInput} from './mermaid-contracts.ts';
/** A measurement-only copy. Final page HTML/CSS are retained verbatim by the
 * compiler; unrelated images and active content never run in the renderer. */
export function prototypeMermaidContext(input:MermaidPreparationInput):MermaidPreparationInput {
 const inertCss=(source:string,inline=false):string=>{
  const edits:{start:number;end:number;text:string}[]=[];
  walk(parse(source,{context:inline?'declarationList':'stylesheet',positions:true} as any),(n:any)=>{
   if(n.type==='Atrule'&&n.name.toLowerCase()==='import')edits.push({start:n.loc.start.offset,end:n.loc.end.offset,text:''});
   else if(n.type==='Url'&&!/^(?:data:font\/|#)/.test(n.value))edits.push({start:n.loc.start.offset,end:n.loc.end.offset,text:'none'});
  });
  const nonoverlapping=edits.filter(e=>!edits.some(o=>o!==e&&o.start<=e.start&&o.end>=e.end)).sort((a,b)=>b.start-a.start);
  for(const e of nonoverlapping)source=source.slice(0,e.start)+e.text+source.slice(e.end);return source;
 };
 const doc=parseFragment(input.html) as any;
 const visit=(node:any):void=>{
  node.childNodes=(node.childNodes??[]).filter((c:any)=>!['script','iframe','frame','object','embed','link','base','meta'].includes(c.tagName));
  for(const a of node.attrs??[]){if(['src','srcset','poster'].includes(a.name)&&!a.value.startsWith('data:'))a.value='data:,';if(a.name==='style')a.value=inertCss(a.value,true);}
  node.attrs=(node.attrs??[]).filter((a:any)=>!/^on/i.test(a.name)&&a.name!=='srcdoc');
  if(node.tagName==='style')for(const c of node.childNodes)c.value=inertCss(c.value??'');
  for(const c of node.childNodes)visit(c);
 };
 visit(doc);return {...input,html:serialize(doc),css:inertCss(input.css)};
}
