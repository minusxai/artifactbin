/** Presentation-only reader highlighting. Offsets preserve every byte outside opted-in code text. */
import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { renderCodeBlock } from '../markdown/code-block';
export function nativeCodeHtml(source:string):string {
 if(!source.includes('rich-native-v1'))return source;
 const edits:Array<{start:number;end:number;text:string}>=[];
 type Node=DefaultTreeAdapterMap['node'];
 const text=(node:Node):string=>'value' in node?node.value:'childNodes' in node?node.childNodes.map(text).join(''):'';
 const walk=(node:Node,native=false,parent='')=>{
  if('tagName' in node){native ||= node.attrs.some(a=>a.name==='data-af-editable'&&a.value==='rich-native-v1');
   if(native&&parent==='pre'&&node.tagName==='code'){
    const loc=node.sourceCodeLocation;
    if(loc?.startTag&&loc.endTag){const language=node.attrs.find(a=>a.name==='class')?.value.match(/(?:^|\s)language-([^\s]+)/)?.[1];
     edits.push({start:loc.startTag.endOffset,end:loc.endTag.startOffset,text:renderCodeBlock(text(node),language).replace(/^<pre><code[^>]*>|<\/code><\/pre>$/g,'')});
    }return;
   }
  }
  if('childNodes' in node)for(const child of node.childNodes)walk(child,native,'tagName' in node?node.tagName:parent);
 };
 walk(parse(source,{sourceCodeLocationInfo:true}));
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.text+source.slice(edit.end);
 return source;
}
