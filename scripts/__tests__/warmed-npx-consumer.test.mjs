import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {findWarmedNpxConsumer} from '../../services/cli/scripts/warmed-npx-consumer.mjs';
async function fixture(options,run){
 const cache=await mkdtemp(join(tmpdir(),'npx-consumer-proof-'));
 try{
  for(const [name,version,integrity] of options){
   const directory=join(cache,'_npx',name),cli=join(directory,'node_modules/@afbin/cli');
   await mkdir(join(cli,'dist'),{recursive:true});
   await writeFile(join(cli,'package.json'),JSON.stringify({name:'@afbin/cli',version}));
   await writeFile(join(cli,'dist/afbin.mjs'),'// candidate');
   await writeFile(join(directory,'node_modules/.package-lock.json'),JSON.stringify({packages:{'node_modules/@afbin/cli':{version,integrity}}}));
  }
  await run(cache);
 }finally{await rm(cache,{recursive:true,force:true});}
}
it('identifies one installed candidate only when its version and tarball integrity match',async()=>{
 await fixture([['fresh','0.4.7','sha512-exact']],async cache=>{
  const result=await findWarmedNpxConsumer(cache,{version:'0.4.7',integrity:'sha512-exact'});
  expect(result).toEqual({directory:join(cache,'_npx/fresh'),version:'0.4.7'});
  await expect(findWarmedNpxConsumer(cache,{version:'0.4.6',integrity:'sha512-exact'})).rejects.toThrow('version');
  await expect(findWarmedNpxConsumer(cache,{version:'0.4.7',integrity:'sha512-other'})).rejects.toThrow('integrity');
 });
});
it('rejects a second npx consumer instead of silently selecting either install',async()=>{
 await fixture([['first','0.4.7','sha512-exact'],['second','0.4.7','sha512-exact']],async cache=>{
  await expect(findWarmedNpxConsumer(cache,{version:'0.4.7',integrity:'sha512-exact'})).rejects.toThrow('one');
 });
});

it('accepts a real cold npm-exec lock receipt and executes the same consumer offline without reification',async()=>{
 const root=await mkdtemp(join(tmpdir(),'real-npx-proof-'));
 try{
  const source=join(root,'package'),work=join(root,'work'),cache=join(root,'cache');
  await mkdir(join(source,'dist'),{recursive:true});await mkdir(work);
  await writeFile(join(source,'package.json'),JSON.stringify({name:'@afbin/cli',version:'0.0.0',bin:{afbin:'dist/afbin.mjs'}}));
  await writeFile(join(source,'dist/afbin.mjs'),"#!/usr/bin/env node\nconsole.log('fixture-offline-ok');\n");
  const npm=process.env.npm_execpath;expect(npm).toBeTruthy();
  const env={...process.env,npm_config_cache:cache,npm_config_audit:'false',npm_config_fund:'false',npm_config_update_notifier:'false'};
  const execute=(args,cwd)=>execFileSync(process.execPath,[npm,...args],{cwd,env,encoding:'utf8',timeout:15000});
  const packed=JSON.parse(execute(['pack','--ignore-scripts','--json','--pack-destination',root],source));
  const tarball=join(root,packed[0].filename),expected={version:'0.0.0',integrity:'sha512-'+createHash('sha512').update(await readFile(tarball)).digest('base64')};
  expect(execute(['exec','--offline','--yes','--package',tarball,'--','afbin'],work)).toContain('fixture-offline-ok');
  const consumer=await findWarmedNpxConsumer(cache,expected);
  expect(execute(['exec','--offline','--yes','--','afbin'],consumer.directory)).toContain('fixture-offline-ok');
  expect(await findWarmedNpxConsumer(cache,expected)).toEqual(consumer);
  expect(await readdir(join(cache,'_npx'))).toHaveLength(1);
 }finally{await rm(root,{recursive:true,force:true});}
});
