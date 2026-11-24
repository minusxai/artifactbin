/** Internal: durable keyed writes, saved before sending; resume saves the server receipt.
 * Used by: toolbox-client.mjs and write commands. */
import path from 'node:path';
import {mkdir,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {ToolError,serverOrigin,credentialRoot,platform,jsonFile,safeParent,
  within} from './toolbox-client.mjs';

const invalid=()=>new ToolError('invalid_folder_request',
 'Folders need a nonblank title (max 200).',2);
/** Validate the entire replayable body; no other artifact kind or write field is accepted. */
export function folderBody(body){
 if(!body||Array.isArray(body)||typeof body!=='object'||
 Object.keys(body).some(key=>!['format','title','visibility',
 'destination','parent_id'].includes(key))||
 body.format!=='folder'||typeof body.title!=='string'||!body.title.trim()||
 body.title.length>200||!body.destination)throw invalid();
 const dest=body.destination;
 if(dest.type==='personal'){
  if(Object.keys(dest).length!==1||!['public','private'].includes(body.visibility))throw invalid();
 }else if(dest.type!=='group'||Object.keys(dest).sort().join(',')!=='id,type'||
  body.visibility!=='private'||typeof dest.id!=='string'||!/^[A-Za-z0-9_]{1,100}$/.test(dest.id))
  throw invalid();
 if(body.parent_id!==undefined&&(!/^[A-Za-z0-9]{6,12}$/.test(body.parent_id)||
 typeof body.parent_id!=='string'))throw invalid();
 return body;
}
export async function createJournal(value,{file,root,project}={}){
if(!file){const directory=path.join(root??credentialRoot(),'requests');await mkdir(directory,{
   recursive:true,mode:0o700});file=path.join(directory,randomUUID()+'.json');}
 file=await safeParent(file);
if(project&&within(await realpath(project),file))throw new ToolError('journal_inside_project',
   'Keep write journals outside served/uploaded project directories.',2);
const {atomicWrite}=await platform();await atomicWrite(file,JSON.stringify(value,null,2)+'\n',{
   exclusive:true});return file;
}
/** @param {any} intent @returns {import(
  '../../../lib/skills/author-toolbox-contract').AuthorJournal} */
export function journalIntent({server,method,path:route,body,operation,source,baseline}){return {
  kind:'author-request',schema:1,server:serverOrigin(server),method,path:route,key:randomUUID(),
  body,operation,...(source?{source}:{}),...(baseline?{baseline}:{})};}
export async function resumeJournal(file,client,operation){
 const saved=await jsonFile(file);
 if(!saved||typeof saved!=='object')throw new ToolError('invalid_journal',
  'Expected a request journal.',2);
 if(operation==='folder-create'){
  if(saved.method!=='POST'||saved.path!=='/api/artifacts'||saved.source||saved.baseline)
   throw new ToolError('invalid_journal','Journal is not a folder create request.',2);
  folderBody(saved.body);
 }
if(!['publish','comment','doc','folder-create'].includes(operation)||
   saved.kind!=='author-request'||saved.schema!==1||saved.operation!==operation||
   saved.server!==client.server||!['POST','PUT','PATCH'].includes(saved.method)||
   !/^[A-Za-z0-9_-]{16,128}$/.test(saved.key??'')||!saved.body||typeof saved.body!=='object'||
   operation==='publish'&&!/^\/api\/artifacts(?:\/[A-Za-z0-9]{6,12})?$/.test(saved.path??'')||
   operation==='comment'&&
   !/^\/api\/artifacts\/[A-Za-z0-9]{6,12}\/annotations(?:\/[A-Za-z0-9_-]+(?:\/reactions)?)?$/.test(
   saved.path??'')||operation==='doc'&&(saved.method!=='PUT'||
   !/^\/api\/artifacts\/[A-Za-z0-9]{6,12}\/regions\/(?:_doc|[A-Za-z][A-Za-z0-9_-]{0,127})$/.test(
   saved.path??'')))throw new ToolError('invalid_journal',
   'Journal does not match this origin, operation or supported endpoint.',2);
 try{
const receipt=await client.request(saved.path,{method:saved.method,body:saved.body,headers:{
    'Idempotency-Key':saved.key},unsafe:true});
try{const {atomicWrite}=await platform();await atomicWrite(file+'.receipt.json',JSON.stringify({
    receipt},null,2)+'\n');}catch{throw new ToolError('receipt_save_failed',
    'Server confirmed the write but its receipt could not be saved.',1,
    'Resume the same journal to recover its confirmed receipt.',{journal:file,committed:true,id:
    receipt.id,version:receipt.version});}return {saved,receipt,journal:file};
}catch(error){if(error.details&&!error.details.committed){try{const {atomicWrite}=await platform();
   await atomicWrite(file+'.receipt.json',JSON.stringify({receipt:error.details},null,2)+'\n');
   }catch{}}error.details={...error.details,journal:file};throw error;}
}
