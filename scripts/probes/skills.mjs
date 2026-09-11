// Fake-home adapter prototype; no real harness installation is performed by this probe.
import {readFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest,stage,recover} from './state.mjs';
const paths={claude:'.claude/skills',codex:'.codex/skills',pi:'.pi/agent/skills',opencode:'.config/opencode/skills'};
const read=async p=>readFile(p,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;});
export async function install(root,requested,bundle) {
 await mkdir(root,{recursive:true});await recover(root);
 const settingsPath='.artifactbin/install.json', prior=await read(join(root,settingsPath));
 const settings=prior?JSON.parse(prior):{selected:[],hashes:{}};
 const selected=requested===undefined?settings.selected:requested.includes('none')?[]:[...new Set(requested)];
 if(selected.some(n=>!paths[n])||(requested?.includes('none')&&requested.length!==1))throw Error('invalid harness');
 const files=[];let changed=0;
 for(const harness of selected){
  const path=paths[harness]+'/artifactbin/SKILL.md', current=await read(join(root,path));
  if(current===bundle)continue;
  if(current!==null&&digest(current)!==settings.hashes[path]) {
   let backup=path+'.backup'; if(await access(join(root,backup)).then(()=>true,()=>false))backup+='.'+randomUUID();
   files.push({path:backup,before:null,data:current,sha256:digest(current)});
  }
  files.push({path,before:current===null?null:digest(current),data:bundle,sha256:digest(bundle)});settings.hashes[path]=digest(bundle);changed++;
 }
 settings.selected=selected; const next=JSON.stringify(settings);
 if(next!==prior)files.push({path:settingsPath,before:prior===null?null:digest(prior),data:next,sha256:digest(next)});
 if(files.length){await stage(root,files);await recover(root);}return {changed,selected};
}
