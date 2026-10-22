import { fileURLToPath } from "node:url";
import type { AuthorNames } from "./contracts.ts";
export function ownedComponentBundleEntry(names: AuthorNames): string {
  const modulePath = (name: string) =>
    JSON.stringify(fileURLToPath(new URL(name, import.meta.url)));
  return `import {setAuthorPorts} from 'author-closure';
import {createSignal,untrack,createContext,useContext,createComponent,createRoot,getOwner,runWithOwner,onCleanup} from 'solid-js';
import {insert} from 'solid-js/web';
import {createAuthorBindings} from ${modulePath("./bindings.ts")};
import {drainAuthorCleanups} from ${modulePath("./cleanup.ts")};
import {createAuthorComponentLifetime} from ${modulePath("./component-lifetime.ts")};
import {createAuthorWindowFacade} from ${modulePath("./window.ts")};
const MountScope=createContext(null);
const reactive={signal:createSignal,untrack,identity:()=>useContext(MountScope),scope:(identity,fn)=>createComponent(MountScope.Provider,{value:identity,get children(){return fn();}})};
let mounted=false;
export async function mount(ports,mounts,options={}){
 if(mounted)throw Error('Author module already mounted');mounted=true;
 const bindings=createAuthorBindings(ports,${JSON.stringify(names)},reactive);setAuthorPorts(bindings);
 const stops=[];let lifetime,stopped=false;const cleanupErrors=[];let failureQueued=false;
 const cleanupError=error=>{cleanupErrors.push(error);if(failureQueued)return;failureQueued=true;queueMicrotask(()=>{try{stop();}catch(error){cleanupErrors.push(error);}let status=document.querySelector("[data-migration-author-status]");if(!status){status=document.createElement("p");status.setAttribute("role","alert");status.setAttribute("data-migration-author-status","");document.body.append(status);}status.hidden=false;status.textContent="Authored content stopped after a cleanup error.";throw new AggregateError(cleanupErrors.splice(0),"Authored module cleanup failed");});};
 const stop=()=>{if(stopped)return;stopped=true;drainAuthorCleanups([()=>lifetime?.dispose(),...stops.splice(0),()=>bindings.dispose(),()=>options.signal?.removeEventListener('abort',stop)]);};
 try{
  if(options.signal?.aborted)throw Error('Author components cancelled');
  const module=await import('authored-module');if(options.signal?.aborted)throw Error('Author components cancelled');
  let components,moduleOwner;
  createRoot(dispose=>{stops.push(dispose);moduleOwner=getOwner();lifetime=createAuthorComponentLifetime({cleanupError,current:getOwner,run:(owner,fn)=>runWithOwner(owner,fn),cleanup:(owner,fn)=>runWithOwner(owner,()=>onCleanup(fn))});components=module.initialize(lifetime,createAuthorWindowFacade(window,lifetime));});
  const identities=new Set();
  for(const item of mounts){if(identities.has(item.identity))throw Error('Duplicate author mount identity');identities.add(item.identity);const component=components[item.component];if(typeof component!=='function')throw Error('Unknown author component');runWithOwner(moduleOwner,()=>createRoot(dispose=>{stops.push(()=>{try{dispose();}finally{item.element.textContent='';}});insert(item.element,bindings.mount(item.identity,()=>component(item.props??{})),item.element.firstChild?null:undefined);}));}
  options.signal?.addEventListener('abort',stop,{once:true});
 }catch(error){try{stop();}catch(cleanup){throw new AggregateError([error,cleanup],'Author component initialization failed');}throw error;}
 return stop;
}`;
}
