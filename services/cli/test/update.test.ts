import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {updateCli} from '../src/update';
import {runCli} from '../src/dispatch';
import {commandHelp} from '../src/commands';
import {diagnosticCatalog} from '../src/diagnostics';
import {CLI_VERSION} from '../src/version';

const SERVER='https://example.test';
const pointer=(body:unknown,status=200)=>{const urls:string[]=[];return {urls,fetch:(async(input:RequestInfo|URL)=>{urls.push(String(input));return Response.json(body,{status});}) as typeof fetch};};
const noNpm=async()=>assert.fail('npm must not run');

test('update --dry-run resolves the server release pointer and runs no npm',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-dry-'));const out:string[]=[];const err:string[]=[];
 try{
  const release=pointer({version:'9.8.7',protocol:3});
  assert.equal(await runCli(['update','--dry-run','--json','--harness','none','--server',SERVER],{home,cwd:home,env:{PATH:''},interactive:false,fetch:release.fetch,npm:noNpm,stdout:s=>out.push(s),stderr:s=>err.push(s)}),0,err.join(''));
  assert.deepEqual(JSON.parse(out.join('')),{dry_run:true,current:CLI_VERSION,target:'9.8.7',command:'npm install -g @afbin/cli@9.8.7'});
  assert.deepEqual(release.urls,[`${SERVER}/chat/release.json`]);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('an unavailable or invalid release pointer falls back to latest, never an error',async()=>{
 const fetches:(typeof fetch)[]=[pointer({error:'down'},500).fetch,pointer({version:'not-a-version',protocol:3}).fetch,pointer('nope').fetch,(async()=>{throw new TypeError('fetch failed');}) as typeof fetch];
 for(const fetch of fetches){
  const result=await updateCli({home:'/unused',server:SERVER,harnesses:[],dryRun:true,fetch,npm:noNpm});
  assert.deepEqual(result,{dry_run:true,current:CLI_VERSION,target:'latest',command:'npm install -g @afbin/cli@latest'});
 }
});

test('update installs the pointer version through npm and then the selected skills',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-run-'));const out:string[]=[];const err:string[]=[];const calls:string[][]=[];
 try{
  const prefix=join(home,'npm');
  const npm=async(args:string[])=>{calls.push(args);if(args.includes('install'))await assert.rejects(stat(join(home,'.pi','agent','skills','artifactbin')),{code:'ENOENT'},'npm runs before skills');return {code:0,stdout:args[0]==='prefix'?prefix+'\n':'',stderr:''};};
  assert.equal(await runCli(['update','--json','--harness','pi','--server',SERVER],{home,cwd:home,env:{PATH:join(prefix,'bin')},interactive:false,fetch:pointer({version:'9.8.7',protocol:3}).fetch,npm,stdout:s=>out.push(s),stderr:s=>err.push(s)}),0,err.join(''));
  assert.deepEqual(calls,[['install','-g','--no-fund','--no-audit','@afbin/cli@9.8.7'],['prefix','-g']]);
  const result=JSON.parse(out.join(''));
  assert.equal(result.version,'9.8.7');assert.equal(result.current,CLI_VERSION);
  assert.deepEqual(result.installed,{status:'installed',version:'9.8.7',prefix,bin:join(prefix,'bin','afbin'),on_path:true,fallback:false});
  assert.deepEqual(result.harnesses,['pi']);assert.equal(result.installations.length,1);
  assert.match(await readFile(join(home,'.pi','agent','skills','artifactbin','SKILL.md'),'utf8'),/name: artifactbin/);
 }finally{await rm(home,{recursive:true,force:true});}
});

test('a failed npm install exits 1 with update_failed and installs no skills',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-update-fail-'));const out:string[]=[];const err:string[]=[];
 try{
  const npm=async()=>({code:1,stdout:'',stderr:'npm error code ENOTFOUND\nnpm error network request failed\n'});
  assert.equal(await runCli(['update','--json','--harness','pi','--server',SERVER],{home,cwd:home,env:{PATH:''},interactive:false,fetch:pointer({},500).fetch,npm,stdout:s=>out.push(s),stderr:s=>err.push(s)}),1);
  const {error}=JSON.parse(out.join(''));
  assert.equal(error.code,'update_failed');assert.equal(error.fix,'npx --yes @afbin/cli@latest setup');assert.match(error.message,/@afbin\/cli@latest/);assert.match(error.message,/ENOTFOUND/);
  await assert.rejects(stat(join(home,'.pi','agent','skills','artifactbin')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});

test('update help and npm recovery copy name the npm install',()=>{
 assert.match(commandHelp('update'),/Install the latest afbin through npm and refresh agent skills\./);
 assert.doesNotMatch(commandHelp('update'),/next launch/);
 assert.equal(diagnosticCatalog.cli_npm_required?.meaning,'afbin now installs through npm. Run npx --yes @afbin/cli@latest setup once, then use afbin.');
 assert.match(diagnosticCatalog.cli_update_required!.fix,/npx --yes @afbin\/cli@latest/);
 assert.match(diagnosticCatalog.cli_update_required!.fix,/npx.cmd/);
 assert.doesNotMatch(diagnosticCatalog.compatible_release_unavailable!.fix,/afbin update --dry-run reports what it resolved/);
});
