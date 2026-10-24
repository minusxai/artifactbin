import {opendir,realpath,stat} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {PREVIEW_LIMITS,PreviewLimitError,readPreviewFile} from './preview-files.mjs';

/** Poll the tree rather than retaining platform-specific watchers: atomic replacements,
 * new dependencies and deletions all affect the next content revision. */
export async function projectRevision(root,limits=PREVIEW_LIMITS){
 root=await realpath(root);
 let hash=createHash('sha256'),count=0,total=0,entries=0;const seen=new Set();
 async function visit(path){
  if(++entries>limits.maxFiles*2+1)throw new PreviewLimitError("Preview directory entry limit exceeded; select a dedicated project directory.");
  const actual=await realpath(path),tail=relative(root,actual);
  if(tail==='..'||tail.startsWith('..'+sep)||tail.split(sep).some(part=>part.startsWith('.')))return;
  const info=await stat(actual);
  if(info.isDirectory()){
   if(seen.has(actual))return;seen.add(actual);
   const names=[];for await(const entry of await opendir(actual))if(!entry.name.startsWith('.')){names.push(entry.name);if(names.length>limits.maxFiles*2)throw new PreviewLimitError('Preview directory entry limit exceeded.');}
   for(const name of names.sort())await visit(join(path,name));
  }else if(info.isFile()){
   if(++count>limits.maxFiles)throw new PreviewLimitError(`Preview exceeds ${limits.maxFiles} files; select a dedicated project directory.`);
   if(info.size>limits.maxFileBytes||total+info.size>limits.maxTotalBytes)throw new PreviewLimitError('Preview size limit exceeded; use files below 32 MiB and a project below 128 MiB.');
   const bytes=await readPreviewFile(root,path,limits.maxFileBytes);total+=bytes.length;
   if(total>limits.maxTotalBytes)throw new PreviewLimitError('Preview exceeds total byte limit.');
   hash.update(relative(root,path));hash.update('\0');hash.update(bytes);hash.update('\0');
  }
 }
 // Editors can replace files while a scan is in progress; retry one inconsistent scan.
 for(let attempt=0;;attempt++)try{await visit(root);return hash.digest('hex');}catch(error){if(attempt||error.code!=='ENOENT')throw error;seen.clear();count=0;total=0;entries=0;hash=createHash('sha256');}
}

/** All viewers of one server share in-flight work and a short revision cache. */
export function createRevisionSource(root,{now=Date.now,scan=()=>projectRevision(root),intervalMs=1000}={}){
 let pending,last,expires=0;
 return {current({fresh=false}={}){
  if(pending)return pending;
  if(!fresh&&last!==undefined&&now()<expires)return Promise.resolve(last);
  pending=Promise.resolve().then(scan).then(value=>{last=value;expires=now()+intervalMs;return value;}).finally(()=>{pending=undefined;});
  return pending;
 }};
}

/** A shadow-root notice avoids author CSS collisions. Polling stops on pagehide,
 * restarts on pageshow, retries after disconnection and never reloads automatically. */
export function changeNotice(revision){
 return `<script data-af-preview-notice>(function(){
 let baseline=${JSON.stringify(revision)},timer,controller,stopped=false,changed=false,epoch=0;
 const host=document.createElement('div');host.setAttribute('data-af-preview-notice','');
 const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>:host{all:initial!important;position:fixed!important;left:0!important;right:0!important;top:0!important;z-index:2147483647!important}div{font:14px system-ui;color:#fff;background:#222;padding:12px 16px;border-radius:0;box-shadow:0 2px 12px #0006}button{font:inherit;margin-left:12px;padding:4px 10px;cursor:pointer}</style><div role="status" hidden><span></span><button type="button" hidden>Reload</button></div>';
 const box=shadow.querySelector('div'),label=shadow.querySelector('span'),reload=shadow.querySelector('button');
 reload.textContent='Reload';reload.onclick=()=>location.reload();document.documentElement.append(host);
 async function poll(){
  if(stopped)return;const generation=epoch;controller=new AbortController();
  try{const response=await fetch('/__af_preview/revision',{cache:'no-store',signal:controller.signal});const value=await response.json();if(!response.ok)throw Error(value.error||'Preview disconnected — retrying');if(stopped||generation!==epoch)return;
   if(value.revision!==baseline)changed=true;
   box.hidden=!changed;label.textContent='File changed';reload.hidden=!changed;dispatchEvent(new CustomEvent('af:preview-status',{detail:{changed,connected:true}}));
  }catch(error){if(stopped||generation!==epoch)return;box.hidden=false;label.textContent=changed?'File changed — '+error.message:error.message;reload.hidden=!changed;dispatchEvent(new CustomEvent('af:preview-status',{detail:{changed,connected:false,error:error.message}}));}
  finally{if(generation===epoch)controller=undefined;if(!stopped&&generation===epoch)timer=setTimeout(poll,1500);}
 }
 function stop(){epoch++;stopped=true;clearTimeout(timer);controller?.abort();}
 function start(){if(!stopped&&timer)return;stopped=false;clearTimeout(timer);timer=setTimeout(poll,1500);}
 addEventListener('pagehide',stop);addEventListener('pageshow',start);start();
})();</script>`;
}
