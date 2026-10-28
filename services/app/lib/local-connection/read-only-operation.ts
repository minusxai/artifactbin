import {getOperationAST,parse,type FieldNode,type SelectionSetNode,type FragmentDefinitionNode} from 'graphql';
/** A selected, bounded mutation is refused as a whole before any namespace executes. */
export function rejectLocalMutation(query:string,operationName?:string){
 const document=parse(query),operation=getOperationAST(document,operationName);
 const fragments=new Map(document.definitions.filter((node):node is FragmentDefinitionNode=>node.kind==='FragmentDefinition').map(node=>[node.name.value,node]));
 const fields=(set:SelectionSetNode,seen=new Set<string>()):FieldNode[]=>set.selections.flatMap(node=>{
  if(node.kind==='Field')return[node];
  if(node.kind==='InlineFragment')return fields(node.selectionSet,seen);
  if(seen.has(node.name.value))return[];const fragment=fragments.get(node.name.value);return fragment?fields(fragment.selectionSet,new Set([...seen,node.name.value])):[];
 });
 const outcomes:Record<string,'rejected'>={},errors:Array<{message:string;path:string[]}>=[];
 if(operation)for(const root of fields(operation.selectionSet)){
  const name=root.alias?.value??root.name.value,children=root.selectionSet?fields(root.selectionSet):[];
  const paths=children.length?children.map(child=>[name,child.alias?.value??child.name.value]):[[name]];
  for(const path of paths){outcomes[path.join('.')]='rejected';errors.push({message:'Downloaded files are read-only. Open original for shared changes.',path});}
 }
 return {data:null,errors,extensions:{outcomes}};
}
