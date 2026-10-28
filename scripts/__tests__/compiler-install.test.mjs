import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {execFileSync,spawnSync} from 'node:child_process';
import YAML from 'yaml';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../..',import.meta.url));

it('rejects a foreign binary override before touching installed compilers',()=>{
 const result=spawnSync(process.execPath,['scripts/ci/prepare-esbuild.mjs'],{cwd:root,encoding:'utf8',env:{...process.env,ESBUILD_BINARY_PATH:'/foreign/compiler'}});
 expect(result.status).not.toBe(0);expect(result.stderr).toContain('External compiler binary override is not admitted');
});
it('fresh installs and every cached CI install preserve the compiler qualification boundary',()=>{
 const pkg=JSON.parse(readFileSync(join(root,'package.json')));expect(pkg.scripts.postinstall).toBe('node scripts/ci/prepare-esbuild.mjs');
 for(const name of ['ci','page-speed','runner-design']){
  const workflow=YAML.parse(readFileSync(join(root,`.github/workflows/${name}.yml`),'utf8'));
  for(const job of Object.values(workflow.jobs))for(const[index,step]of(job.steps??[]).entries())if(step.run==='npm ci'){
   expect(job.steps[index+1]?.run).toBe('node scripts/ci/prepare-esbuild.mjs');
  }
 }
});
it('actual prepared host compilers match source receipts for every installed locked version',()=>{
 const receipt=JSON.parse(execFileSync(process.execPath,['scripts/ci/prepare-esbuild.mjs'],{cwd:root,encoding:'utf8'}).trim().replace('PASS source-built installed compiler ',''));
 const lock=JSON.parse(readFileSync(join(root,'package-lock.json')));
 const installed=Object.entries(lock.packages).filter(([p])=>(p==='node_modules/esbuild'||p.endsWith('/node_modules/esbuild'))&&(()=>{try{return JSON.parse(readFileSync(join(root,p,'package.json'))).version;}catch{return false;}})()).map(([path,item])=>({path,version:item.version}));
 expect(receipt.go).toBe('go1.27.3');expect(receipt.sys).toBe('v0.44.0');
 expect(receipt.packages.map(({path,version})=>({path,version}))).toEqual(installed);
 for(const entry of receipt.packages)expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
});
