/** Mechanical tag formatting. Prose, comments and expression bytes are never reserialized. */
import {parseJsx,type JsxNode} from '@/lib/jsx';
export function formatMarkupSource(source:string):string {
 const parsed=parseJsx(source);
 if(!parsed.ok)throw new Error('Fix the JSX syntax before formatting.');
 const edits:Array<{start:number;end:number;text:string}>=[];
 const walk=(nodes:JsxNode[])=>{for(const node of nodes){if(node.type!=='element')continue;
  if(!node.control){
   const last=node.attributes.at(-1)?.end??node.start+1+node.tag.length;
   const end=source.indexOf('>',last)+1;
   if(end<=last)throw new Error('Could not locate the opening tag.');
   const attrs=node.attributes.map(a=>source.slice(a.start,a.end).trim().replace(/^([^=\s]+)\s*=\s*/, '$1='));
   const suffix=node.selfClosing?' />':'>';
   const line=`<${node.tag}${attrs.length?' '+attrs.join(' '):''}${suffix}`;
   const column=node.start-(source.lastIndexOf('\n',node.start)+1);
   const indent=' '.repeat(column+2);
   const text=line.length+column<=100||attrs.length<2?line:`<${node.tag}\n${attrs.map(x=>indent+x).join('\n')}\n${' '.repeat(column)}${node.selfClosing?'/>':'>'}`;
   edits.push({start:node.start,end,text});
  }
  walk(node.children);
 }};
 walk(parsed.nodes);
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
 return source;
}
