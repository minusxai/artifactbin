import {DEFAULT_UPLOAD_MAX_BYTES,type DatasetUploadResult} from '@artifactbin/contracts';
import {randomUUID} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {basename,resolve} from 'node:path';
import {fileContentType} from '../../app/lib/document/file-types';
import {declarationsOf} from '../../app/lib/document/helmet';
import {CliError,type ParsedCommand} from './commands';
import {artifactReference} from './read-commands';
import type {HttpClient} from './http';
import type {Workspace,Snapshot} from './workspace';

/** A receipt names this document's served attachment; it carries no bearer grant. */
function validReceipt(result:DatasetUploadResult,documentId:string,datasetId:string,client:HttpClient):boolean{
 if(typeof result.ref!=='string'||!/^dfile:[a-z0-9]+$/.test(result.ref)||typeof result.url!=='string'||typeof result.name!=='string'||!result.name.trim()||typeof result.contentType!=='string'||!result.contentType.trim()||!Number.isSafeInteger(result.size)||result.size<0||(result.replayed!==undefined&&typeof result.replayed!=='boolean'))return false;
 try{
  const url=new URL(result.url,client.connection.server);
  return client.sameServer(url.origin)&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname===`/a/${documentId}/datasets/${datasetId}/files/${result.ref.slice('dfile:'.length)}`;
 }catch{return false;}
}

/** Resolve a named published import; the server owns permission and storage validation. */
export async function uploadAttachment(workspace:Workspace,parsed:ParsedCommand,client:HttpClient):Promise<DatasetUploadResult>{
 const ref=await artifactReference(workspace,String(parsed.flags.in),client.connection.server,true,client.aliases);
 if(ref.version!==undefined)throw new CliError('historical_upload','Uploads target the current document; omit @version.');
 const path=resolve(workspace.cwd,parsed.positionals[0]),name=basename(path),contentType=fileContentType(name);
 if(!contentType)throw new CliError('unsupported_file_type',`Unsupported file type: ${name}.`);
 const info=await stat(path);
 if(!info.isFile())throw new CliError('invalid_file','Upload requires one regular file.');
 if(info.size>DEFAULT_UPLOAD_MAX_BYTES)throw new CliError('file_too_large',`Uploads must be at most ${DEFAULT_UPLOAD_MAX_BYTES} bytes.`);
 const bytes=await readFile(path);
 if(bytes.length>DEFAULT_UPLOAD_MAX_BYTES)throw new CliError('file_too_large',`Uploads must be at most ${DEFAULT_UPLOAD_MAX_BYTES} bytes.`);
 const head=await client.request<Snapshot>(`/artifacts/${ref.id}`);
 if(head.id!==ref.id||typeof head.edit_id!=='string'||!head.edit_id||head.format!=='markup'||typeof head.markup!=='string')throw new CliError('invalid_response','The server did not return a complete document snapshot.');
 const declarations=declarationsOf(head.markup);
 if(!declarations)throw new CliError('invalid_response','The published document declarations could not be read.');
 const imported=declarations.imports.find(item=>item.name===parsed.flags.name);
 if(!imported)throw new CliError('unknown_import',`The document does not declare import ${parsed.flags.name}.`,declarations.imports.length?`Declared imports: ${declarations.imports.map(item=>item.name).join(', ')}.`:'This document declares no dataset imports.');
 const key=typeof parsed.flags['idempotency-key']==='string'?parsed.flags['idempotency-key']:randomUUID();
 let result:DatasetUploadResult;
 try{result=await client.upload<DatasetUploadResult>(`/artifacts/${ref.id}/datasets/${imported.ref}/files`,bytes,{'Content-Type':contentType,'X-Edit-Id':head.edit_id,'X-Filename':encodeURIComponent(name),'Idempotency-Key':key});}
 catch(error){if(error instanceof CliError&&(error.code==='outcome_unknown'||error.code==='invalid_response'||[408,429,500,502,503,504].includes(Number((error.details as {http_status?:number}|undefined)?.http_status))))throw new CliError(error.code,error.message,`Retry the same upload with --idempotency-key ${key}.`);throw error;}
 if(!validReceipt(result,ref.id,imported.ref,client))throw new CliError('invalid_response','The upload returned an incomplete file receipt.',`Retry the same upload with --idempotency-key ${key}.`);
 return result;
}
