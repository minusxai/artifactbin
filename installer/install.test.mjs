import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { installSkill, readArchive, normalizeOrigin } from './install.mjs';
function archive(entries) {
  const chunks=[];
  for (const [name, body, type='0'] of entries) {
    const header=Buffer.alloc(512); header.write(name); header.write('0000644\0',100); header.write(body.length.toString(8).padStart(11,'0')+'\0',124); header.write('        ',148); header.write(type,156); header.write('ustar\0',257);
    const sum=header.reduce((a,b)=>a+b,0); header.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    chunks.push(header,Buffer.from(body),Buffer.alloc((512-body.length%512)%512));
  }
  return gzipSync(Buffer.concat([...chunks,Buffer.alloc(1024)]));
}
const valid=()=>archive([['pagegi-author/SKILL.md','name: artifactbin-author\nhttps://app.artefactbin.dev'],['pagegi-author/scripts/auth.mjs','https://app.artefactbin.dev']]);
async function fixture(run) { const home=await mkdtemp(join(tmpdir(),'skill-test-')); try { await run(home); } finally { await rm(home,{recursive:true,force:true}); } }
test('installs discovered agents and replaces only the owned skill, using configured origin',()=>fixture(async home=>{
 await mkdir(join(home,'.codex')); await mkdir(join(home,'.claude/skills/artifactbin-author'),{recursive:true});
 await writeFile(join(home,'.claude/skills/artifactbin-author/stale'),'old'); await writeFile(join(home,'.claude/skills/unrelated'),'keep');
 const result=await installSkill({home,origin:'http://localhost:4000',archive:valid()}); assert.equal(result.length,2);
 assert.match(await readFile(join(home,'.agents/skills/artifactbin-author/scripts/auth.mjs'),'utf8'),/http:\/\/localhost:4000/);
 assert.equal(await readFile(join(home,'.claude/skills/unrelated'),'utf8'),'keep');
 assert.deepEqual(await readdir(join(home,'.claude/skills/artifactbin-author')),['SKILL.md','scripts']);
}));
for(const [name,bytes] of [['corrupt',Buffer.from('bad')],['traversal',archive([['pagegi-author/../outside','bad']])],['link',archive([['pagegi-author/SKILL.md','bad','2']])],['missing',archive([['pagegi-author/README','bad']])]]) test(`rejects ${name} without changing existing files`,()=>fixture(async home=>{
 await mkdir(join(home,'.claude/skills/artifactbin-author'),{recursive:true}); await writeFile(join(home,'.claude/skills/artifactbin-author/old'),'keep');
 await assert.rejects(installSkill({home,origin:'https://example.invalid',archive:bytes})); assert.equal(await readFile(join(home,'.claude/skills/artifactbin-author/old'),'utf8'),'keep');
}));
test('rejects invalid origins and checksums',()=>{
 for(const origin of ['file:///tmp', 'https://user:secret@example.invalid', 'https://example.invalid/path']) assert.throws(()=>normalizeOrigin(origin));
 const damaged=gunzipSync(valid()); damaged[0]=120; assert.throws(()=>readArchive(gzipSync(damaged)),/checksum/);
});

test('replacement failure restores old skill and leaves unrelated files',()=>fixture(async home=>{
 const fs=await import('node:fs/promises'); const parent=join(home,'.claude/skills');
 await mkdir(join(parent,'artifactbin-author'),{recursive:true}); await writeFile(join(parent,'artifactbin-author/old'),'keep'); await writeFile(join(parent,'unrelated'),'keep');
 await assert.rejects(installSkill({home,origin:'https://example.invalid',archive:valid()},{...fs,rename:async (from,to)=>{if(from.endsWith('/next'))throw Error('replacement failure');return fs.rename(from,to);}}),/replacement failure/);
 assert.equal(await readFile(join(parent,'artifactbin-author/old'),'utf8'),'keep'); assert.deepEqual((await readdir(parent)).sort(),['artifactbin-author','unrelated']);
}));
test('restore failure retains a recoverable backup',()=>fixture(async home=>{
 const fs=await import('node:fs/promises'); const parent=join(home,'.claude/skills');
 await mkdir(join(parent,'artifactbin-author'),{recursive:true}); await writeFile(join(parent,'artifactbin-author/old'),'keep');
 await assert.rejects(installSkill({home,origin:'https://example.invalid',archive:valid()},{...fs,rename:async (from,to)=>{if(from.endsWith('/next')||from.endsWith('/previous'))throw Error('failure');return fs.rename(from,to);}}),/previous skill retained/);
 const [stage]=await readdir(parent); assert.equal(await readFile(join(parent,stage,'previous/old'),'utf8'),'keep');
}));
