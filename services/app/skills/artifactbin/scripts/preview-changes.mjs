/**
 * Internal: project change detection for the preview: a polled content revision of the served tree
 * and the in-page notice that offers a reload (and dataset export) when it changes.
 * Used by: preview.mjs, html-preview.test.mjs.
 */
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
if(++entries>limits.maxFiles*2+1)throw new PreviewLimitError(
    "Preview directory entry limit exceeded; select a dedicated project directory.");
  const actual=await realpath(path),tail=relative(root,actual);
  // Skip anything outside the root (symlinks) and dot-files/directories, as the server does.
  if(tail==='..'||tail.startsWith('..'+sep)||tail.split(sep).some(part=>
   part.startsWith('.')))return;
  const info=await stat(actual);
  if(info.isDirectory()){
   if(seen.has(actual))return;seen.add(actual);
const names=[];for await(const entry of await opendir(actual))if(!entry.name.startsWith('.')){
     names.push(entry.name);if(names.length>limits.maxFiles*2)throw new PreviewLimitError(
     'Preview directory entry limit exceeded.');}
   for(const name of names.sort())await visit(join(path,name));
  }else if(info.isFile()){
if(++count>limits.maxFiles)throw new PreviewLimitError(
     `Preview exceeds ${limits.maxFiles} files; select a dedicated project directory.`);
if(info.size>limits.maxFileBytes||total+info.size>limits.maxTotalBytes)throw new PreviewLimitError(
     'Preview size limit exceeded; use files below 32 MiB and a project below 128 MiB.');
   const bytes=await readPreviewFile(root,path,limits.maxFileBytes);total+=bytes.length;
   if(total>limits.maxTotalBytes)throw new PreviewLimitError('Preview exceeds total byte limit.');
   hash.update(relative(root,path));hash.update('\0');hash.update(bytes);hash.update('\0');
  }
 }
 // Editors can replace files while a scan is in progress; retry one inconsistent scan.
for(let attempt=0;;attempt++)try{await visit(root);return hash.digest('hex');}catch(error){if(
   attempt||error.code!=='ENOENT')throw error;seen.clear();count=0;total=0;entries=0;hash=
   createHash('sha256');}
}

/** All viewers of one server share in-flight work and a short revision cache. */
export function createRevisionSource(root,{now=Date.now,scan=()=>projectRevision(root),intervalMs=
  1000}={}){
 let pending,last,expires=0;
 return {current({fresh=false}={}){
  if(pending)return pending;
  if(!fresh&&last!==undefined&&now()<expires)return Promise.resolve(last);
pending=Promise.resolve().then(scan).then(value=>{last=value;expires=now()+intervalMs;return value;
    }).finally(()=>{pending=undefined;});
  return pending;
 }};
}

/** A shadow-root notice avoids author CSS collisions. Polling stops on pagehide,
 * restarts on pageshow, retries after disconnection and never reloads automatically. */
export function changeNotice(revision,localConfig){
 return `<script data-af-preview-notice>(function(){
 const baseline=${JSON.stringify(revision)},local=${JSON.stringify(localConfig??null)};
 let timer,controller,stopped=false,changed=false,epoch=0,dirty=false,conflict=false,problem='';
 const host=document.createElement('div');host.setAttribute('data-af-preview-notice','');
 const shadow=host.attachShadow({mode:'open'});shadow.innerHTML='<style>`+
   `:host{all:initial!important;position:fixed!important;left:0!important;right:0!important;`+
   `top:var(--af-preview-notice-top,0px)!important;z-index:2147483647!important}div{font:14px `+
   `system-ui;color:#fff;background:#222;padding:12px 16px;box-shadow:0 2px 12px `+
   `#0006}button,a{font:inherit;margin-left:12px;padding:4px `+
   `10px;cursor:pointer;color:inherit}button{color:#111}p{margin:8px 0 0}</style><div `+
   `role="status" hidden><span></span><nav></nav><button type="button" hidden>Reload</button><p `+
   `hidden>Reload discards the current local dataset session. Export edits first, or explicitly `+
   `discard them.<button type="button">Reload and discard local edits</button></p></div>';
 const box=shadow.querySelector('div'),label=shadow.querySelector('span'),`+
   `links=shadow.querySelector('nav'),buttons=shadow.querySelectorAll('button'),reload=buttons[0],`+
   `discard=buttons[1],confirmation=shadow.querySelector('p');
 if(local)for(const name of local.names){const link=document.createElement('a');`+
   `link.textContent='Export '+name;link.href=local.endpoint+'/export/'+encodeURIComponent(name);`+
   `link.download='local-'+name+'.json';links.append(link);}
 function render(){const shared=document.documentElement.getAttribute(`+
   `'data-af-local-chrome-ready')==='true';host.style.setProperty('--af-preview-notice-top',`+
   `shared?'76px':'0px');box.hidden=shared?confirmation.hidden:!changed&&!dirty&&!conflict&&`+
   `!problem;label.textContent=problem||(changed?(dirty?'File changed — local dataset edits are `+
   `unsaved':'File changed'):(conflict?'Local data source changed — retained unsaved `+
   `session':'Local dataset edits are unsaved'));reload.hidden=!changed&&!dirty&&!conflict;`+
   `links.hidden=!dirty&&!conflict;}
 async function readStatus(signal){if(!local)return;const response=await `+
   `fetch(local.endpoint+'/status',{cache:'no-store',signal});const status=await `+
   `response.json();if(!response.ok)throw Error(status.error||'Local session `+
   `unavailable');dirty=status.dirty;conflict=status.conflict;}
 async function reloadPreview(){try{await readStatus();if(dirty||conflict)`+
   `{confirmation.hidden=false;render();}else location.reload();}catch(error)`+
   `{problem=error.message;confirmation.hidden=false;render();}}
 reload.onclick=reloadPreview;const requestedReload=()=>{void reloadPreview();};
 const chromeObserver=new MutationObserver(render);
 discard.onclick=async()=>{try{const response=await fetch(local.endpoint+'/discard',`+
   `{method:'POST',credentials:'omit'});if(!response.ok)throw Error('Could not discard local `+
   `session; retry');location.reload();}catch(error){problem=error.message;render();}};
 document.documentElement.append(host);
 async function poll(){
  if(stopped)return;const generation=epoch;controller=new AbortController();
  try{const response=await fetch('/__af_preview/revision',{cache:'no-store',`+
   `signal:controller.signal});const value=await response.json();if(!response.ok)throw `+
   `Error(value.error||'Preview disconnected — retrying');
   await readStatus(controller.signal);if(stopped||generation!==epoch)return;
   if(value.revision!==baseline)changed=true;problem='';render();dispatchEvent(new `+
   `CustomEvent('af:preview-status',{detail:{changed,dirty,conflict,connected:true}}));
  }catch(error){if(stopped||generation!==epoch)return;try{await `+
   `readStatus(controller.signal);}catch{}if(stopped||generation!==epoch)return;`+
   `problem=error.message;render();dispatchEvent(new CustomEvent('af:preview-status',`+
   `{detail:{changed,dirty,conflict,connected:false,error:error.message}}));}
  finally{if(generation===epoch)controller=undefined;if(!stopped&&generation===epoch)`+
   `timer=setTimeout(poll,1500);}
 }
 function stop(){epoch++;stopped=true;chromeObserver.disconnect();`+
   `removeEventListener('af:preview-reload',requestedReload);clearTimeout(timer);`+
   `controller?.abort();}
 function start(){if(!stopped&&timer)return;stopped=false;`+
   `chromeObserver.observe(document.documentElement,{attributes:true,`+
   `attributeFilter:['data-af-local-chrome-ready']});addEventListener('af:preview-reload',`+
   `requestedReload);render();clearTimeout(timer);timer=setTimeout(poll,1500);}
 addEventListener('pagehide',stop);addEventListener('pageshow',start);start();
})();</script>`;
}
