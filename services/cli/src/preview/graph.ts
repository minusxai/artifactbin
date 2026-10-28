/** Session scope is the selected documents and their registered ID references. */
import {collectRefUses,parseJsx,type JsxNode} from '../../../app/lib/cli-toolkit';
export function referenceIds(source:string):Set<string>{
  const ids=new Set((collectRefUses(source)??[]).map(ref=>ref.id));
  const parsed=parseJsx(source);
  const walk=(nodes:JsxNode[])=>{for(const node of nodes)if(node.type==='element'){
   if(node.tag!=='Iframe'){
    for(const attr of node.attributes)if(attr.name==='href'&&attr.value.static&&typeof attr.value.json==='string'){
     const match=/^\/a\/([A-Za-z0-9]{6,12})$/.exec(attr.value.json);if(match)ids.add(match[1]!);
    }
    walk(node.children);
   }
  }};
  if(parsed.ok)walk(parsed.nodes);
  return ids;
}
