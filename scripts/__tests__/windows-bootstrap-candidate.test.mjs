import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolveBootstrapCandidate} from '../../services/cli/scripts/windows-bootstrap-candidate.mjs';

it('reuses only the exact npm-resolved candidate and refuses ambiguity or mismatched provenance',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-bootstrap-candidate-')),cache=join(root,'cache'),tarball=join(root,'candidate.tgz');
 const bytes=Buffer.from('exact-candidate-fixture'),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
 await writeFile(tarball,bytes);
 const slot=async(name,version='0.4.46',digest=integrity)=>{
  const base=join(cache,'_npx',name),pkg=join(base,'node_modules','@afbin','cli');
  await mkdir(join(pkg,'dist'),{recursive:true});
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@afbin/cli',version,bin:{afbin:'dist/afbin.mjs'}}));
  await writeFile(join(pkg,'dist','afbin.mjs'),'// fixture entry');
  await writeFile(join(base,'package-lock.json'),JSON.stringify({packages:{'node_modules/@afbin/cli':{version,integrity:digest}}}));
  return join(pkg,'dist','afbin.mjs');
 };
 try{
  const entry=await slot('owned');expect(await resolveBootstrapCandidate(cache,tarball,'0.4.46')).toBe(entry);
  const command=fileURLToPath(new URL('../../services/cli/scripts/windows-bootstrap-candidate.mjs',import.meta.url));
  const resolved=spawnSync(process.execPath,[command,cache,tarball,'0.4.46'],{encoding:'utf8'});expect(resolved.status,resolved.stderr).toBe(0);expect(resolved.stdout).toBe(entry+'\n');expect(resolved.stderr).toBe('');
  const missing=spawnSync(process.execPath,[command,join(root,'missing'),tarball,'0.4.46'],{encoding:'utf8'});expect(missing.status).toBe(1);expect(missing.stdout).toBe('');expect(missing.stderr).toBe('bootstrap_candidate_unavailable\n');
  await slot('older','0.4.45');expect(await resolveBootstrapCandidate(cache,tarball,'0.4.46')).toBe(entry);
  await slot('mismatch','0.4.46','sha512-unrelated');expect(await resolveBootstrapCandidate(cache,tarball,'0.4.46')).toBe(entry);
  await slot('duplicate');await expect(resolveBootstrapCandidate(cache,tarball,'0.4.46')).rejects.toThrow(/candidate/);
  await rm(join(cache,'_npx','duplicate'),{recursive:true});
  await rm(join(cache,'_npx','owned','node_modules','@afbin','cli','dist','afbin.mjs'));
  await expect(resolveBootstrapCandidate(cache,tarball,'0.4.46')).rejects.toThrow(/candidate/);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('refuses a linked candidate entry even when its package metadata claims the exact tarball',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-bootstrap-link-')),cache=join(root,'cache'),tarball=join(root,'candidate.tgz'),pkg=join(cache,'_npx','linked','node_modules','@afbin','cli');
 const bytes=Buffer.from('candidate');await mkdir(join(pkg,'dist'),{recursive:true});await writeFile(tarball,bytes);
 await writeFile(join(root,'elsewhere.mjs'),'// foreign entry');
 await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@afbin/cli',version:'0.4.46',bin:{afbin:'dist/afbin.mjs'}}));
 await writeFile(join(cache,'_npx','linked','package-lock.json'),JSON.stringify({packages:{'node_modules/@afbin/cli':{version:'0.4.46',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}}}));
 try{await symlink(join(root,'elsewhere.mjs'),join(pkg,'dist','afbin.mjs'));await expect(resolveBootstrapCandidate(cache,tarball,'0.4.46')).rejects.toThrow(/candidate/);}
 finally{await rm(root,{recursive:true,force:true});}
});

it('fails closed on malformed runtime metadata, invalid bin identity and a lost cache',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-bootstrap-invalid-')),cache=join(root,'cache'),tarball=join(root,'candidate.tgz'),base=join(cache,'_npx','owned'),pkg=join(base,'node_modules','@afbin','cli');
 const bytes=Buffer.from('candidate'),integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
 await mkdir(join(pkg,'dist'),{recursive:true});await writeFile(tarball,bytes);await writeFile(join(pkg,'dist','afbin.mjs'),'throw Error("must never execute during discovery")');
 await writeFile(join(base,'package-lock.json'),JSON.stringify({packages:{'node_modules/@afbin/cli':{version:'0.4.46',integrity}}}));
 try{
  for(const manifest of ['{',JSON.stringify({name:'foreign',version:'0.4.46',bin:{afbin:'dist/afbin.mjs'}}),JSON.stringify({name:'@afbin/cli',version:'0.4.46',bin:{afbin:'../../foreign.mjs'}}),JSON.stringify({name:'@afbin/cli',version:'0.4.46',bin:['dist/afbin.mjs']})]){
   await writeFile(join(pkg,'package.json'),manifest);await expect(resolveBootstrapCandidate(cache,tarball,'0.4.46')).rejects.toThrow(/candidate/);
  }
  await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@afbin/cli',version:'0.4.46',bin:{afbin:'dist/afbin.mjs'}}));
  await writeFile(join(base,'package-lock.json'),'{');await expect(resolveBootstrapCandidate(cache,tarball,'0.4.46')).rejects.toThrow(/candidate/);
  await rm(cache,{recursive:true});await expect(resolveBootstrapCandidate(cache,tarball,'0.4.46')).rejects.toThrow(/candidate/);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('rejects linked ancestry instead of following a cache slot into another package tree',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-bootstrap-ancestry-')),cache=join(root,'cache'),tarball=join(root,'candidate.tgz'),base=join(cache,'_npx','owned'),modules=join(root,'foreign-modules'),pkg=join(modules,'@afbin','cli');
 const bytes=Buffer.from('candidate');await mkdir(join(pkg,'dist'),{recursive:true});await mkdir(base,{recursive:true});await writeFile(tarball,bytes);
 await writeFile(join(pkg,'package.json'),JSON.stringify({name:'@afbin/cli',version:'0.4.46',bin:{afbin:'dist/afbin.mjs'}}));await writeFile(join(pkg,'dist','afbin.mjs'),'// foreign entry');
 await writeFile(join(base,'package-lock.json'),JSON.stringify({packages:{'node_modules/@afbin/cli':{version:'0.4.46',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}}}));
 try{await symlink(modules,join(base,'node_modules'),'junction');await expect(resolveBootstrapCandidate(cache,tarball,'0.4.46')).rejects.toThrow(/candidate/);}
 finally{await rm(root,{recursive:true,force:true});}
});
