import {readFile,realpath} from 'node:fs/promises';
import {basename,dirname,extname,relative,resolve} from 'node:path';
import {parseJsx,type JsxNode} from '../../app/lib/jsx';
import {fileContentType} from '../../app/lib/story/file-types';
import {REFERENCE_POSITIONS} from '../../app/lib/story/reference-positions';
import {urlListUrls} from '../../app/lib/jsx/url-attrs';
import {parseCsv} from '../../app/lib/data-ingest/csv';
import {CliError} from './commands';
import {confinedPath} from './journal';
export interface Dependency {bytes:Buffer;path:string;authored:string;id:string;input:Record<string,unknown>;uses:Array<{start:number;end:number;attribute:string;authored?:string;list?:boolean;original?:string}>}
const referenceAttributes=new Set([...REFERENCE_POSITIONS.map(position=>position.attribute),'source','data','recipe']);
export async function planDependencies(source:string,path:string,root:string):Promise<Dependency[]>{
 root=await realpath(root);
 const parsed=parseJsx(source);if(!parsed.ok)return[];
 const byPath=new Map<string,Dependency>();
 const candidates:Array<{value:string;start:number;end:number;attribute:string;authored?:string;list?:boolean;original?:string}>=[];
 const walk=(nodes:JsxNode[])=>{for(const node of nodes)if(node.type==='element'){
  for(const attr of node.attributes){
   const attribute=attr.name.toLowerCase();
   if(!referenceAttributes.has(attribute)||!attr.value.static||typeof attr.value.json!=='string')continue;
   const list=REFERENCE_POSITIONS.some(position=>position.attribute===attribute&&position.list);
   for(const value of list?urlListUrls(attr.value.json,attribute):[attr.value.json]){
    if(!value||value.startsWith('$')||value.startsWith('#')||/^[a-z][a-z0-9+.-]*:/i.test(value)||value.startsWith('//'))continue;
    if(attribute==='href'&&value.startsWith('/'))continue;
    if(!value.startsWith('.')&&!extname(value))continue;
    if(value.startsWith('/')||value.includes('?')||value.includes('#'))throw new CliError('invalid_dependency',`Use a workspace-relative file path for ${value}.`);
    candidates.push({value,start:attr.start,end:attr.end,attribute:attr.name,...(list?{list:true,original:attr.value.json}:{})});
   }
  }
  walk(node.children);
 }};walk(parsed.nodes);
 for(const candidate of candidates){
  const absolute=await confinedPath(root,resolve(root,dirname(path),candidate.value));
  const local=relative(root,absolute);
  let dependency=byPath.get(local);
  if(!dependency){
   let bytes:Buffer;try{bytes=await readFile(absolute);}catch{throw new CliError('missing_dependency',`Cannot read dependency ${candidate.value} in ${path}.`,'Keep dependencies inside the workspace and check their paths.');}
   dependency={bytes,path:local,authored:candidate.value,id:`local${String(byPath.size+1).padStart(6,'0')}`,input:assetInput(local,bytes),uses:[]};byPath.set(local,dependency);
  }
  dependency.uses.push({start:candidate.start,end:candidate.end,attribute:candidate.attribute,authored:candidate.value,...(candidate.list?{list:true,original:candidate.original}:{})});
 }
 return [...byPath.values()];
}
export function substituteDependencies(source:string,dependencies:Dependency[],ids?:Record<string,string>):string{
 const edits=new Map<number,{start:number;end:number;attribute:string;value:string;list:boolean;replacements:Map<string,string>}>();
 for(const dependency of dependencies)for(const use of dependency.uses){
  let edit=edits.get(use.start);
  if(!edit){edit={...use,value:use.original??use.authored??dependency.authored,list:!!use.list,replacements:new Map()};edits.set(use.start,edit);}
  edit.replacements.set(use.authored??dependency.authored,`ref:${ids?.[dependency.path]??dependency.id}`);
 }
 for(const edit of [...edits.values()].sort((a,b)=>b.start-a.start)){
  const value=edit.list?edit.value.split(',').map(entry=>entry.replace(/^(\s*)(\S+)/,(_match,space,url)=>space+(edit.replacements.get(url)??url))).join(','):edit.replacements.values().next().value!;
  source=source.slice(0,edit.start)+`${edit.attribute}=${JSON.stringify(value)}`+source.slice(edit.end);
 }
 return source;
}
export function assetInput(path:string,bytes:Buffer):Record<string,unknown>{
 const extension=extname(path).toLowerCase();
 if(extension==='.csv'){
  if(!parseCsv(bytes.toString()).headers.length)throw new CliError('invalid_dataset',`${path} has no CSV columns.`);
  return{dataset:bytes.toString()};
 }
 if(extension==='.json'){
  let rows:unknown;try{rows=JSON.parse(bytes.toString());}catch{throw new CliError('invalid_dataset',`${path} is not valid JSON.`);}
  if(!Array.isArray(rows)||!rows.every(row=>row!==null&&typeof row==='object'&&!Array.isArray(row)))throw new CliError('invalid_dataset',`${path} must contain an array of row objects.`,'Run afbin help data.');
  return{dataset:rows};
 }
 const contentType=fileContentType(basename(path));if(!contentType)throw new CliError('unsupported_file_type',`Unsupported file type: ${path}.`,'Use JSX documents, CSV/JSON rows or supported media files.');
 if(['.png','.jpg','.jpeg','.webp','.gif','.svg'].includes(extension))return{image:`data:${contentType};base64,${bytes.toString('base64')}`};
 if(extension==='.pdf')return{pdf:`data:application/pdf;base64,${bytes.toString('base64')}`};
 return{file:{filename:basename(path),contentType,base64:bytes.toString('base64')}};
}

/** Restore only reference positions whose confined local files remain available. */
export async function restoreDependencyPaths(source:string,paths:Record<string,string>,documentPath:string,root:string):Promise<string>{
 root=await realpath(root);
 const available=new Map<string,string>();
 for(const [id,path] of Object.entries(paths)){
  try{await readFile(await confinedPath(root,resolve(root,dirname(documentPath),path)));available.set(`ref:${id}`,path);}
  catch{/* Missing or escaped files retain their canonical reference. */}
 }
 const parsed=parseJsx(source);if(!parsed.ok)return source;
 const edits:Array<{start:number;end:number;value:string}>=[];
 const walk=(nodes:JsxNode[])=>{for(const node of nodes)if(node.type==='element'){
  for(const attr of node.attributes){
   const attribute=attr.name.toLowerCase();
   if(!referenceAttributes.has(attribute)||!attr.value.static||typeof attr.value.json!=='string')continue;
   const list=REFERENCE_POSITIONS.some(position=>position.attribute===attribute&&position.list);
   const original=attr.value.json;
   const value=list?original.split(',').map(entry=>entry.replace(/^(\s*)(\S+)/,(_match,space,url)=>space+(available.get(url)??url))).join(','):available.get(original)??original;
   if(value!==original)edits.push({start:attr.start,end:attr.end,value:`${attr.name}=${JSON.stringify(value)}`});
  }
  walk(node.children);
 }};walk(parsed.nodes);
 for(const edit of edits.sort((a,b)=>b.start-a.start))source=source.slice(0,edit.start)+edit.value+source.slice(edit.end);
 return source;
}
