import {readdir,readFile,realpath,stat} from 'node:fs/promises';
import {join,relative,sep} from 'node:path';
import {createHash} from 'node:crypto';

/** Poll the tree rather than retaining platform-specific watchers: atomic replacements,
 * new dependencies and deletions all affect the next content revision. */
export async function projectRevision(root){
 let hash=createHash('sha256'),count=0;const seen=new Set();
 async function visit(path){
  const actual=await realpath(path),tail=relative(root,actual);
  if(tail==='..'||tail.startsWith('..'+sep)||tail.split(sep).some(part=>part.startsWith('.')))return;
  const info=await stat(actual);
  if(info.isDirectory()){
   if(seen.has(actual))return;seen.add(actual);
   for(const name of (await readdir(actual)).sort())if(!name.startsWith('.'))await visit(join(path,name));
  }else if(info.isFile()){
   if(++count>2000)throw Error('Preview supports at most 2000 project files');
   hash.update(relative(root,path));hash.update('\0');hash.update(await readFile(actual));hash.update('\0');
  }
 }
 // Editors can replace files while a scan is in progress; retry one inconsistent scan.
 for(let attempt=0;;attempt++)try{await visit(root);return hash.digest('hex');}catch(error){if(attempt||error.code!=='ENOENT')throw error;seen.clear();count=0;hash=createHash('sha256');}
}

/** A shadow-root notice avoids author CSS collisions. Polling stops on pagehide,
 * restarts on pageshow, retries after disconnection and never reloads automatically. */
export function changeNotice(revision){
 return `<script data-af-preview-notice>(function(){
 let baseline=${JSON.stringify(revision)},timer,controller,stopped=false,changed=false,epoch=0;
 const host=document.createElement('div');host.setAttribute('data-af-preview-notice','');
 const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>:host{all:initial!important;position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important}div{font:14px system-ui;color:#fff;background:#222;padding:12px 16px;border-radius:8px;box-shadow:0 2px 12px #0006}button{font:inherit;margin-left:12px;padding:4px 10px;cursor:pointer}</style><div role="status" hidden><span></span><button type="button" hidden>Reload</button></div>';
 const box=shadow.querySelector('div'),label=shadow.querySelector('span'),reload=shadow.querySelector('button');
 reload.textContent='Reload';reload.onclick=()=>location.reload();document.documentElement.append(host);
 async function poll(){
  if(stopped)return;const generation=epoch;controller=new AbortController();
  try{const response=await fetch('/__af_preview/revision',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('Disconnected');const value=await response.json();if(stopped||generation!==epoch)return;
   if(value.revision!==baseline)changed=true;
   box.hidden=!changed;label.textContent='File changed';reload.hidden=!changed;
  }catch(error){if(stopped||generation!==epoch)return;box.hidden=false;label.textContent=changed?'File changed — preview disconnected':'Preview disconnected — retrying';reload.hidden=!changed;}
  finally{if(generation===epoch)controller=undefined;if(!stopped&&generation===epoch)timer=setTimeout(poll,1500);}
 }
 function stop(){epoch++;stopped=true;clearTimeout(timer);controller?.abort();}
 function start(){if(!stopped&&timer)return;stopped=false;clearTimeout(timer);timer=setTimeout(poll,1500);}
 addEventListener('pagehide',stop);addEventListener('pageshow',start);start();
})();</script>`;
}
