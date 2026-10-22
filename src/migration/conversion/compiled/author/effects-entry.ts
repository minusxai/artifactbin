import { fileURLToPath } from "node:url";
import type { AuthorNames } from "./contracts.ts";
export function effectBundleEntry(names: AuthorNames): string {
  const modulePath = (name: string) =>
    JSON.stringify(fileURLToPath(new URL(name, import.meta.url)));
  return `import {setAuthorPorts} from 'author-closure';
import {createSignal,untrack,createRoot,getOwner,runWithOwner} from 'solid-js';
import {createAuthorBindings} from ${modulePath("./bindings.ts")};
import {drainAuthorCleanups} from ${modulePath("./cleanup.ts")};
import {createAuthorEffectLifetime} from ${modulePath("./lifecycle.ts")};
import {createAuthorWindowFacade} from ${modulePath("./window.ts")};
let mounted=false;
export async function mount(ports,mounts,options={}){
 if(mounted||mounts.length)throw Error('Invalid effect module mount');mounted=true;
 const bindings=createAuthorBindings(ports,${JSON.stringify(names)},{signal:createSignal,untrack,identity:()=>null,scope:(_,fn)=>fn()});
 setAuthorPorts(bindings);let lifetime,stopped=false;
 const stop=()=>{if(stopped)return;stopped=true;drainAuthorCleanups([()=>lifetime?.dispose(),()=>bindings.dispose()]);};
 try{if(options.signal?.aborted)throw Error('Author effects cancelled');const module=await import('authored-module');if(options.signal?.aborted)throw Error('Author effects cancelled');
 createRoot(dispose=>{const owner=getOwner();lifetime=createAuthorEffectLifetime({timeout:(f,t)=>setTimeout(f,t),interval:(f,t)=>setInterval(f,t),frame:f=>requestAnimationFrame(f),clearTimeout:id=>clearTimeout(id),clearInterval:id=>clearInterval(id),cancelFrame:id=>cancelAnimationFrame(id)},fn=>runWithOwner(owner,fn));lifetime.own(dispose);if(options.signal)lifetime.listen(options.signal,'abort',stop,{once:true});module.initialize(lifetime,createAuthorWindowFacade(window,lifetime));});
 }catch(error){try{stop();}catch(cleanup){throw new AggregateError([error,cleanup],'Author effects failed');}throw error;}
 return stop;
}`;
}
