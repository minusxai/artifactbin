/** Session scope is the selected documents and their registered ID references. */
import {readFile,realpath,lstat} from 'node:fs/promises';
import {extname,join} from 'node:path';
import {collectRefUses,parseJsx,type JsxNode} from '../../../app/lib/cli-toolkit';
import {parseDocument} from '../document';
import {confinedPath} from '../journal';
export async function previewGraph(root:string,entry:string,localFiles:Record<string,string>={},virtualFiles?:Record<string,string>):Promise<string[]>{
 root=await realpath(root);const selected=new Set<string>();
 async function visit(path:string):Promise<void>{
  if(selected.has(path))return;selected.add(path);
  // Import preflight supplies future bytes; every external registered dependency must already exist without symlinks.
  const virtual=virtualFiles!==undefined&&Object.hasOwn(virtualFiles,path);
  if(virtualFiles!==undefined&&!virtual){let current=root;for(const part of path.split('/')){current=join(current,part);if((await lstat(current)).isSymbolicLink())throw new Error(`Preview dependency may not follow a symlink: ${path}`);}}
  const full=await confinedPath(root,join(root,path));
  if(extname(path).toLowerCase()!=='.jsx')return;
  const document=parseDocument(virtual?virtualFiles![path]!:await readFile(full,'utf8'));
  const ids=referenceIds(document.body);
  for(const id of ids)if(localFiles[id])await visit(localFiles[id]);
 }
 await visit(entry);return [...selected];
}

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
