/** Server-derived names for membership guards. A declaration edit must detect a
 * concurrently added consumer, even though that new node was absent when planned.
 * SQL compares selected identity sets; revisions guard the selected node data.
 * SQL identifiers are conservative: extra dependencies only reject concurrency.
 */
import type {JsxNode} from '../jsx/types';
import {collectRefNameUses} from './dataflow';
export function graphSelectors(node:JsxNode):string[] {
 const selectors=new Set<string>();
 const own=node.type==='element'?{...node,children:[]}:node;
 for(const use of collectRefNameUses([own]))selectors.add(`use:${use.name}`);
 if(node.type==='element'){
  selectors.add(`tag:${node.tag}`);
  const string=(name:string)=>{const value=node.attributes.find(a=>a.name===name)?.value;return value?.static&&typeof value.json==='string'?value.json:undefined;};
  const id=string('id');if(id)selectors.add(`id:${id}`);
  if(['Value','Query','Mutation'].includes(node.tag)){
   const name=string('name');if(name)selectors.add(`declaration:${name}`);
   if(node.tag!=='Value'){
    // Parsing the SQL remains the existing validator's job. Index all identifier
    // spellings, including quoted/string occurrences just like queryDeps.
    const sql=node.children.map(child=>child.type==='text'?child.value:child.type==='expression'&&child.value.static&&typeof child.value.json==='string'?child.value.json:'').join('');
    for(const word of sql.match(/[A-Za-z_]\w*/g)??[])selectors.add(`dependency:${word}`);
   }
  }
 }
 return [...selectors].sort();
}
