import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
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
test('packed package runs through npm exec with no repository dependencies',()=>fixture(async home=>{
 const {execFile}=await import('node:child_process'); const {promisify}=await import('node:util'); const {createServer}=await import('node:http');
 const exec=promisify(execFile), cwd=new URL('.',import.meta.url);
 const packed=await exec('npm',['pack','--json','--pack-destination',home],{cwd}); const tarball=join(home,JSON.parse(packed.stdout)[0].filename);
 const server=createServer((req,res)=>{
  assert.equal(req.url,'/skills/pagegi-author.tgz');res.end(valid());
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const origin=`http://127.0.0.1:${server.address().port}`;
  // Exercise npm's real bin installation from the packed local tarball. Registry
  // audit/update traffic is unrelated to this contract and must stay offline.
  const result=await exec('npm',['exec','--yes','--package',tarball,'--','artefactbin-skill','--origin',origin],{cwd:home,env:{PATH:process.env.PATH,HOME:home,npm_config_cache:join(home,'npm-cache'),npm_config_offline:'true',npm_config_audit:'false',npm_config_update_notifier:'false',npm_config_registry:origin,npm_config_userconfig:join(home,'.npmrc')},timeout:30000});
  assert.match(result.stdout,/Installed artifactbin-author/);
  assert.match(await readFile(join(home,'.claude/skills/artifactbin-author/SKILL.md'),'utf8'),new RegExp(origin));
 } finally {await new Promise(resolve=>server.close(resolve));}
}));
