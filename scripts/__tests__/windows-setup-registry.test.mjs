import {it,expect} from 'vitest';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveBootstrapCandidate} from '../../services/cli/scripts/windows-bootstrap-candidate.mjs';
import {candidateManifest,startCandidateRegistry} from '../../services/cli/scripts/windows-setup-registry.mjs';

function archive(manifest){
 const body=Buffer.from(JSON.stringify(manifest)),header=Buffer.alloc(512);
 header.write('package/package.json');header.write(body.length.toString(8).padStart(11,'0'),124);
 return gzipSync(Buffer.concat([header,body,Buffer.alloc(512-body.length%512),Buffer.alloc(1024)]));
}
it('serves the exact unpublished candidate with dependencies and verified npm integrity',async()=>{
 const manifest={name:'@afbin/cli',version:'0.0.0-test',bin:{afbin:'dist/afbin.mjs'},dependencies:{sharp:'1.2.3'}};
 const bytes=archive(manifest),registry=await startCandidateRegistry(bytes);
 try{
  const response=await fetch(registry.origin+'/@afbin%2fcli');expect(response.status).toBe(200);
  const metadata=await response.json(),candidate=metadata.versions[manifest.version];
  expect(candidate.dependencies).toEqual(manifest.dependencies);
  expect(metadata['dist-tags'].latest).toBe(manifest.version);
  expect(candidate.dist.integrity).toBe('sha512-'+createHash('sha512').update(bytes).digest('base64'));
  expect(Buffer.from(await (await fetch(candidate.dist.tarball)).arrayBuffer())).toEqual(bytes);
  expect((await fetch(registry.origin+'/other-package')).status).toBe(404);
 }finally{await registry.close();}
});
it('rejects archives without the expected npm manifest',()=>{
 expect(()=>candidateManifest(gzipSync(Buffer.alloc(1024)))).toThrow(/manifest/);
 expect(()=>candidateManifest(archive({name:'other',version:'1.0.0'}))).toThrow(/@afbin\/cli/);
});


it('installs a fresh first npx candidate from manifest metadata, verifies exact bytes and globally installs the same candidate',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'afbin-registry-npx-'))),cache=join(root,'cache'),pkg=join(root,'package'),prefix=join(root,'global'),tarball=join(root,'candidate.tgz'),requests=[];
 let registry;
 try{
  await mkdir(join(pkg,'dist'),{recursive:true});
  const version='0.4.48',entry=`#!/usr/bin/env node
console.log(JSON.stringify({query:true,version:'${version}'}));`;
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@afbin/cli',version,type:'module',bin:{afbin:'dist/afbin.mjs'},scripts:{postinstall:`node -e "require('fs').writeFileSync('lifecycle-ran','yes')"`}}));
  await writeFile(join(pkg,'dist','afbin.mjs'),entry,{mode:0o755});
  execFileSync('tar',['-czf',tarball,'-C',root,'package']);
  const bytes=await readFile(tarball);registry=await startCandidateRegistry(bytes,{onRequest:path=>requests.push(path)});
  const npm=process.env.npm_execpath??join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'npm/bin/npm-cli.js');
  const env={...process.env,HOME:root,USERPROFILE:root,npm_config_cache:cache,npm_config_registry:registry.origin,npm_config_prefer_offline:'true',npm_config_full_metadata:'true',npm_config_fetch_retries:'0',npm_config_audit:'false',npm_config_fund:'false'};
  const run=async(args)=>promisify(execFile)(process.execPath,args,{cwd:root,env,timeout:15000});
  const result=await run([join(dirname(npm),'npx-cli.js'),'--yes','--package','@afbin/cli@'+version,'afbin','query','rows.csv','--json']);
  expect(JSON.parse(result.stdout)).toEqual({query:true,version});
  expect(requests.filter(path=>path==='/@afbin/cli').length).toBeGreaterThan(0);
  expect(requests.filter(path=>path==='/candidate.tgz')).toHaveLength(1);
  const installed=await resolveBootstrapCandidate(cache,tarball,version);expect(await readFile(installed,'utf8')).toBe(entry);
  expect(await readFile(join(dirname(dirname(installed)),'lifecycle-ran'),'utf8')).toBe('yes');
  await run([npm,'install','--global','--prefix',prefix,'@afbin/cli@'+version]);
  const globalRoot=(await run([npm,'root','--global','--prefix',prefix])).stdout.trim();
  expect(await readFile(join(globalRoot,'@afbin','cli','dist','afbin.mjs'),'utf8')).toBe(entry);
  expect(await readFile(join(globalRoot,'@afbin','cli','lifecycle-ran'),'utf8')).toBe('yes');
  // Both actual npm consumers resolve registry metadata instead of inflating a local tarball for identity.
  expect(requests.filter(path=>path==='/@afbin/cli').length).toBeGreaterThan(0);expect(requests.filter(path=>path==='/candidate.tgz')).toHaveLength(1);
  await writeFile(tarball,Buffer.concat([bytes,Buffer.from('changed candidate')]));
  await expect(resolveBootstrapCandidate(cache,tarball,version)).rejects.toThrow(/candidate/);
 }finally{await registry?.close();await rm(root,{recursive:true,force:true});}
});
