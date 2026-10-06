import {tsImport} from 'tsx/esm/api';
// Gates are plain Node entry points: use the same explicit TypeScript boundary as fixture-http,
// so identity is parsed by the existing shared contract rather than copied into the gate.
const {artifactIdFromPath}=await tsImport('@artifactbin/utils/artifact-reference',import.meta.url);

/** A native fork reaches its copy directly or via the new account's Welcome return address. */
export function forkDestination(url,originalId){
 let target=url;
 if(url.pathname==='/welcome'){
  const callback=url.searchParams.get('callbackUrl');
  if(!callback)return null;
  try{target=new URL(callback,url);}catch{return null;}
 }
 if(target.origin!==url.origin)return null;
 const id=artifactIdFromPath(target.pathname);
 return id&&id!==originalId?{id,path:target.pathname}:null;
}
