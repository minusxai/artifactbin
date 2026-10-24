import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {loadImportedPilotProbe} from '../lib/native-prepared-pilot-probe.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
it('executes only a digest-bound standalone private probe from disposable scratch',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'pilot-probe-'));
 try{
  const bundle=path.join(root,'bundle');await mkdir(bundle);
  const bytes='export async function mountImportedPilot({state}) { return {ready:async()=>{if(state.id!=="expected")throw Error("assertion");}} }';
  await writeFile(path.join(bundle,'probe.mjs'),bytes);
  const input={probe:{path:'probe.mjs',sha256:sha(bytes)},bundleFiles:[{path:'probe.mjs',sha256:sha(bytes)}]};
  const loaded=await loadImportedPilotProbe({input,bundle,scratch:path.join(root,'scratch')});
  await (await loaded.mountImportedPilot({state:{id:'expected'}})).ready();
  await expect((await loaded.mountImportedPilot({state:{id:'wrong'}})).ready()).rejects.toThrow('assertion');
  expect(loaded.sha256).toBe(sha(bytes));
  await writeFile(path.join(bundle,'probe.mjs'),'changed');
  await expect(loadImportedPilotProbe({input,bundle,scratch:path.join(root,'scratch2')})).rejects.toThrow('probe');
 }finally{await rm(root,{recursive:true,force:true});}
});
it('refuses missing manifests, path escapes, missing files, symlinks and non-probe modules',async()=>{
 const root=await mkdtemp(path.join(tmpdir(),'pilot-probe-invalid-'));
 try{
  const bytes='export const mountImportedPilot=1;',entry={path:'probe.mjs',sha256:sha(bytes)};
  await writeFile(path.join(root,'probe.mjs'),bytes);const invoke=input=>loadImportedPilotProbe({input,bundle:root,scratch:path.join(root,'scratch')});
  for(const input of [{probe:entry,bundleFiles:[]},{probe:{...entry,path:'../probe.mjs'},bundleFiles:[entry]},{probe:{...entry,path:'missing.mjs'},bundleFiles:[{...entry,path:'missing.mjs'}]},{probe:entry,bundleFiles:[entry]}])await expect(invoke(input)).rejects.toThrow('probe');
  await symlink(path.join(root,'probe.mjs'),path.join(root,'link.mjs'));const link={...entry,path:'link.mjs'};await expect(invoke({probe:link,bundleFiles:[link]})).rejects.toThrow('probe');
  expect(await invoke({})).toBeUndefined();
 }finally{await rm(root,{recursive:true,force:true});}
});
