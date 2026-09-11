/**
 * Workstream D (Distribution and teaching) seeds: update --dry-run, help --format/--output,
 * and no npm install teaching anywhere in the bundle. Each test is `todo` until its row is
 * implemented; the owner removes the todo option, never the assertion. Installer and plugin
 * assembly checks live in scripts/__tests__/cli-install.test.mjs and cli-release.test.mjs.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runCli} from '../src/dispatch';
import teaching from '../src/generated/teaching.json';

async function harness(prefix:string){
 const root=await mkdtemp(join(tmpdir(),prefix));const out:string[]=[];let network=0;
 const invoke=(args:string[],respond?:(path:string)=>Response)=>runCli(args,{cwd:root,home:root,env:{},interactive:false,stdout:s=>out.push(s),stderr:()=>{},fetch:async(input)=>{network++;const url=new URL(String(input));if(!respond)throw new Error('offline operation attempted HTTP');return respond(url.pathname);}});
 return {root,out,invoke,network:()=>network,last:()=>JSON.parse(out[out.length-1]),cleanup:()=>rm(root,{recursive:true,force:true})};
}

test('update --dry-run resolves the compatible release and reports binary, skill and plugin changes without installing',async()=>{
 const h=await harness('afbin-seed-update-dry-');
 try{
  const code=await h.invoke(['update','--dry-run','--harness','pi','--json','--server','https://example.com'],path=>Response.json(path.includes('release')?{version:'9.9.9',protocol:1,assets:{}}:{error:'not_found'},{status:path.includes('release')?200:404}));
  assert.equal(code,0,h.out.join(''));
  const result=h.last();assert.equal(result.dry_run,true);assert.ok(result.binary);assert.ok(Array.isArray(result.skills));assert.ok('plugins' in result);
  assert.deepEqual((await readdir(h.root)).filter(name=>name!=='.artifactbin'),[],'dry-run writes nothing to the home directory');
 }finally{await h.cleanup();}
});

test('help --format man and --output write bundled documentation offline',async()=>{
 const h=await harness('afbin-seed-help-man-');
 try{
  assert.equal(await h.invoke(['help','--format','man','--output','afbin.1','--json']),0,h.out.join(''));
  assert.equal(h.network(),0);
  const man=await readFile(join(h.root,'afbin.1'),'utf8');assert.match(man,/^\.TH /m);assert.match(man,/afbin export/);assert.ok(!man.includes('afbin api'));
  assert.equal(await h.invoke(['help','export','--format','markdown']),0,h.out.join(''));
  assert.match(h.out.join(''),/^## export|^# afbin export/m);
 }finally{await h.cleanup();}
});

test('the bundled teaching never instructs an npm install or a remote skill fetch',()=>{
 for(const [file,text] of Object.entries(teaching.files as Record<string,string>)){
  assert.ok(!/npm install -g|npx afbin|npm i -g/.test(text),`${file} teaches npm installation`);
  assert.ok(!/MCP|\/docs\/llm|skills\.download/.test(text),`${file} teaches a remote or MCP surface`);
 }
 assert.match(teaching.files['references/publishing-auth.md'],/\/chat\/install\.sh/);
});
