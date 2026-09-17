import {readdir,realpath,stat} from 'node:fs/promises';
import {join,relative,resolve} from 'node:path';
import {confinedPath} from './journal';
import {CliError} from './errors';
export interface PreviewOptions {cwd:string;home:string;paths:string[];port:number;share:boolean;server?:string;json:boolean}
/** Expand explicit directories without following symlinks or traversing hidden/dependency trees. */
export async function previewFiles(root:string,cwd:string,inputs:string[]):Promise<string[]>{
 root=await realpath(root);const files=new Set<string>();
 const visit=async(path:string)=>{
  path=resolve(path)===root?root:await confinedPath(root,path);
  if((await stat(path)).isDirectory()){
   for(const entry of await readdir(path,{withFileTypes:true})){
    if(entry.name.startsWith('.')||['node_modules','dist','build'].includes(entry.name)||entry.isSymbolicLink())continue;
    if(entry.isDirectory()||entry.name.toLowerCase().endsWith('.jsx'))await visit(join(path,entry.name));
   }
  }else if(path.toLowerCase().endsWith('.jsx'))files.add(relative(root,path));
  else throw new CliError('unsupported_preview','Preview accepts JSX documents or directories.');
 };
 for(const input of inputs)await visit(resolve(cwd,input));
 if(!files.size)throw new CliError('missing_file','No JSX documents were found in the selected paths.');
 return [...files];
}
