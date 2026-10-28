/**
 * Internal: bounded, root-contained file reads for the preview (2,000 files, 32 MiB per file,
 * 128 MiB total) and the PreviewLimitError the server answers with 413.
 * Used by: preview.mjs, preview-changes.mjs, preview-sessions.mjs, preview-source-routes.mjs.
 */
import {open,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {relative,sep} from 'node:path';
export const PREVIEW_LIMITS=Object.freeze({maxFiles:2000,maxFileBytes:32*1024*1024,maxTotalBytes:
  128*1024*1024});
export class PreviewLimitError extends Error {constructor(message){super(message);this.code=
  'PREVIEW_LIMIT';}}
export function withinRoot(root,path){const tail=relative(root,path);return tail!== '..'&&
  !tail.startsWith('..'+sep)&&!tail.startsWith(sep)&&!tail.split(sep).some(part=>part.startsWith(
  '.'));}
/** Hold one descriptor while checking identity and reading bounded bytes. O_NOFOLLOW
 * refuses a swapped leaf link. Node has no portable openat directory capability:
 * this is not a sandbox against an adversary concurrently replacing root parents. */
export async function readPreviewFile(root,path,maxBytes=PREVIEW_LIMITS.maxFileBytes){
const actual=await realpath(path);if(!withinRoot(root,actual))throw Error(
   'File outside preview root');
 const handle=await open(actual,constants.O_RDONLY|constants.O_NOFOLLOW);
 try {
  const before=await handle.stat();if(!before.isFile())throw Error('Not a regular file');
if(before.size>maxBytes)throw new PreviewLimitError(
    `Preview file exceeds ${maxBytes} bytes; select a smaller project root or reduce the file.`);
const verified=await realpath(path);if(!withinRoot(root,verified))throw Error(
    'File outside preview root');
const identity=await stat(verified);if(identity.ino!==before.ino||
    identity.dev!==before.dev)throw Error('File changed during preview read; retry.');
  const buffer=Buffer.alloc(Math.min(before.size+1,maxBytes+1));let offset=0;
while(offset<buffer.length){const {bytesRead}=await handle.read(buffer,offset,buffer.length-offset,
    offset);if(!bytesRead)break;offset+=bytesRead;}
  if(offset>before.size)throw Error('File changed during preview read; retry.');
  return buffer.subarray(0,offset);
 }finally{await handle.close();}
}
