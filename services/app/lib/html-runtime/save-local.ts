import {downloadPortableCopy,serializePortableCopy} from './browser-portable';
import {recoverPortableSource} from './portable-source';
import {readPortableDocument,hasPortableDocument} from './portable';
import type {PortableDocument,PortableIdentity} from './portable-contract';
import type {HtmlJsonObject} from '@artifactbin/contracts';
export interface SaveLocalDocumentOptions {
 win:Window;
 identity?:PortableIdentity;
 publishedSource?:{source:string;localSourceDigest:string};
 privateState?:HtmlJsonObject;
 /** Trusted preview helper can supply actual source bytes after an explicit Save action. */
 sourceBytes?:string;
 onSource?(source:string):void;
}
/** The current file is explicitly selected; a saved canonical envelope cannot hide agent edits. */
export async function saveLocalDocument(options:SaveLocalDocumentOptions):Promise<boolean>{
 const {win}=options;
 let name='page.html',sourceBytes=options.sourceBytes;
 let assetDocument=win.document;
 const preview=win.document.documentElement.hasAttribute('data-af-private-preview')&&win.location.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(win.location.hostname);
 if(preview){
  const responses=await Promise.all([win.fetch('/__af_preview/source?'+new URLSearchParams({path:win.location.pathname}),{credentials:'omit',redirect:'error'}),win.fetch('/__af_preview/export-runtime',{credentials:'omit',redirect:'error'})]);
  if(responses.some(response=>!response.ok))throw Error('Local source or runtime unavailable; original file unchanged');
  const selected=await responses[0]!.json(),assets=await responses[1]!.json();
  if(typeof selected.html!=='string')throw Error('Local source unavailable');
  sourceBytes=selected.html;name=decodeURIComponent(win.location.pathname.split('/').pop()||'page.html');
  assetDocument=new DOMParser().parseFromString('<html><head></head><body></body></html>','text/html');
  const runtime=win.document.querySelector('script[data-af="runtime"]')?.textContent??JSON.stringify({pageId:'local:'+win.location.pathname,revision:'local',backends:[],offline:true});
  for(const key of ['runtime','apollo','reader','chrome','core']){const value=key==='runtime'?runtime:assets[key];if(typeof value!=='string'){if(key==='chrome')continue;throw Error('Local runtime unavailable');}const script=assetDocument.createElement('script');script.setAttribute('data-af',key);if(key!=='core')script.type='application/json';script.textContent=key==='core'||key==='runtime'?value:JSON.stringify(value);assetDocument.head.append(script);}
 }
 if(sourceBytes===undefined){
  const file=await new Promise<File|null>(resolve=>{
   const picker=win.document.createElement('input');picker.type='file';picker.accept='.html,.htm,text/html';
   picker.addEventListener('change',()=>resolve(picker.files?.[0]??null),{once:true});
   picker.addEventListener('cancel',()=>resolve(null),{once:true});picker.click();
  });
  if(!file)return false;name=file.name;sourceBytes=await file.text();
 }
 let portable:PortableDocument;
 if(hasPortableDocument(sourceBytes))portable=readPortableDocument(sourceBytes);
 else portable={version:1,source:sourceBytes};
 if(options.identity){
  const saved=portable.identity;
  if(saved&&(saved.platformOrigin!==options.identity.platformOrigin||saved.artifactId!==options.identity.artifactId))throw Error('Choose this document’s current HTML file');
  portable={...portable,identity:options.identity};
 }
 options.onSource?.(recoverPortableSource(sourceBytes));
 const html=serializePortableCopy({document:assetDocument,sourceBytes,portable,publishedSource:options.publishedSource,...(options.privateState?{privateState:options.privateState}:{})});
 downloadPortableCopy(win,html,name);
 return true;
}
