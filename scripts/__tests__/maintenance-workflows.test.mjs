/** Execute the npm publisher's actual shell steps against isolated GitHub/npm fixtures. */
import {spawnSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {parse} from 'yaml';
const root=resolve(import.meta.dirname,'../..');
const workflow=name=>parse(readFileSync(join(root,'.github/workflows',name),'utf8'));
const sha=letter=>letter.repeat(40);
const integrity=bytes=>'sha512-'+createHash('sha512').update(bytes).digest('base64');
it('keeps paid deployment and custom executable runtime maintenance out of npm delivery',()=>{
 for(const name of ['publish.yml','performance.yml','agent-smoke-nightly.yml','update-cli-version.yml','cli-runtime.yml'])expect(existsSync(join(root,'.github/workflows',name)),name).toBe(false);
 const ci=workflow('ci.yml');expect(ci.jobs).not.toHaveProperty('agent-smoke');expect(ci.jobs).not.toHaveProperty('mx-agent-trials');
});
it('publishes only successful main CI artifacts through trusted npm publishing',()=>{
 const definition=workflow('release-cli.yml');expect(definition.on.workflow_run.workflows).toEqual(['ci']);expect(definition.jobs.release.if).toContain("github.event.workflow_run.conclusion == 'success'");
 expect(definition.permissions['id-token']).toBe('write');expect(JSON.stringify(definition)).not.toContain('build:binary');
});
function packageBytes(version,options={}){
 const fixture=mkdtempSync(join(tmpdir(),'npm-release-bytes-'));
 try{
  const directory=join(fixture,'package');mkdirSync(directory);writeFileSync(join(directory,'package.json'),JSON.stringify({name:options.name??'@artifactbin/cli',version}));
  if(!options.noLock)writeFileSync(join(directory,'npm-shrinkwrap.json'),'{}');
  if(options.native){mkdirSync(join(directory,'dist/runtime/node_modules/sharp'),{recursive:true});writeFileSync(join(directory,'dist/runtime/node_modules/sharp/native.node'),'build-machine');}
  const file=join(fixture,'package.tgz');const packed=spawnSync('tar',['-czf',file,'-C',fixture,'package'],{encoding:'utf8'});if(packed.status!==0)throw Error(packed.stderr);
  return readFileSync(file);
 }finally{rmSync(fixture,{recursive:true,force:true});}
}
const artifact=(version,bytes=packageBytes(version))=>({'afbin-npm-release':{[`artifactbin-cli-${version}.tgz`]:bytes.toString('base64')}});
const receipt=id=>({'tested-run':{'tested-run.json':Buffer.from(JSON.stringify({run_id:id})).toString('base64')}});
const GH=String.raw`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const file=process.env.RELEASE_STATE,state=JSON.parse(fs.readFileSync(file)),args=process.argv.slice(2),flag=name=>args[args.indexOf(name)+1];
const save=()=>fs.writeFileSync(file,JSON.stringify(state)),fail=message=>{console.error(message);process.exit(1)},answer=value=>{const jq=args.includes('--jq')?flag('--jq'):null;if(!jq){console.log(JSON.stringify(value));process.exit(0);}const result=spawnSync('jq',['-r',jq],{input:JSON.stringify(value),encoding:'utf8'});process.stdout.write(result.stdout);process.exit(result.status);};
if(args[0]==='api'){
 const route=args.find(a=>a.startsWith('repos/')).replace(/^repos\/[^/]+\/[^/]+\//,'');
 if(route==='git/ref/heads/main')answer({object:{sha:state.head}});
 if(route.startsWith('contents/')){const commit=state.commits[route.split('ref=')[1]];if(!commit)fail('HTTP 404');const value={version:route.includes('release.json')?(commit.pointer??commit.version):commit.version};answer({content:Buffer.from(JSON.stringify(value)).toString('base64')});}
 const run=/actions\/runs\/(\d+)\/artifacts/.exec(route);if(run)answer({artifacts:Object.keys(state.runs[run[1]]??{}).map(name=>({name,expired:false}))});
}
if(args[0]==='run'&&args[1]==='download'){const files=state.runs[args[2]]?.[flag('--name')];if(!files)fail('No artifact');fs.mkdirSync(flag('--dir'),{recursive:true});for(const [name,data]of Object.entries(files))fs.writeFileSync(path.join(flag('--dir'),name),Buffer.from(data,'base64'));process.exit(0);}
if(args[0]==='release'&&args[1]==='view'){if(!state.releases[args[2]])fail('HTTP 404');answer({isDraft:state.releases[args[2]].draft});}
if(args[0]==='release'&&args[1]==='create'){state.calls.push('release '+args[2]+' '+flag('--target'));state.releases[args[2]]={draft:false};save();process.exit(0);}
if(args[0]==='release'&&args[1]==='upload'){state.calls.push('upload '+args[2]);save();process.exit(0);}
if(args[0]==='release'&&args[1]==='edit'){state.calls.push('finish '+args[2]);state.releases[args[2]]={draft:false};save();process.exit(0);}
fail('Unexpected gh '+args.join(' '));
`;
const NPM=String.raw`#!${process.execPath}
const fs=require('node:fs'),crypto=require('node:crypto'),file=process.env.RELEASE_STATE,state=JSON.parse(fs.readFileSync(file)),args=process.argv.slice(2);
if(args[0]==='view'){if(state.registryError){console.error('E500 registry unavailable');process.exit(1);}const version=args[1].split('@').at(-1),published=state.published[version];if(!published){console.error('E404 version absent');process.exit(1);}console.log(args[2]==='version'?version:published);process.exit(0);}
if(args[0]==='publish'){for(const flag of ['--access','--provenance','--ignore-scripts'])if(!args.includes(flag))throw Error('Unsafe publish arguments');const bytes=fs.readFileSync(args[1]);state.calls.push('npm '+crypto.createHash('sha512').update(bytes).digest('base64'));fs.writeFileSync(file,JSON.stringify(state));process.exit(0);}
throw Error('Unexpected npm '+args.join(' '));
`;
function release(repo,source){
 const fixture=mkdtempSync(join(tmpdir(),'npm-release-flow-'));
 try{
  const state=join(fixture,'state.json');writeFileSync(state,JSON.stringify({releases:{},runs:{},published:{},calls:[],...repo}));mkdirSync(join(fixture,'bin'));for(const [name,code]of [['gh',GH],['npm',NPM]]){const file=join(fixture,'bin',name);writeFileSync(file,code);chmodSync(file,0o755);}
  const job=workflow('release-cli.yml').jobs.release,outputs={};
  const context={'github.token':'fixture-not-secret','github.event.workflow_run.head_sha':source,'github.event.workflow_run.id':'42'};
  const expand=text=>String(text).replace(/\$\{\{\s*(.+?)\s*\}\}/g,(_,key)=>{const step=/^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(key);return step?outputs[step[1]]?.[step[2]]??'':context[key];});
  const envFor=values=>Object.fromEntries(Object.entries(values??{}).map(([key,value])=>[key,expand(value)]));
  let failure=null;
  for(const step of job.steps){
   if(step.uses)continue;
   if(step.if){const condition=/^steps\.([\w-]+)\.outputs\.([\w-]+) != ''$/.exec(step.if);if(!outputs[condition[1]]?.[condition[2]])continue;}
   const output=join(fixture,'output');writeFileSync(output,'');const result=spawnSync('bash',['--noprofile','--norc','-eo','pipefail','-c',step.run],{cwd:fixture,encoding:'utf8',env:{...process.env,PATH:join(fixture,'bin')+':'+process.env.PATH,RELEASE_STATE:state,GITHUB_REPOSITORY:'minusxai/artifactbin',GITHUB_OUTPUT:output,...envFor(job.env),...envFor(step.env)}});
   if(result.status!==0){failure=`${step.name}: ${result.stdout}${result.stderr}`;break;}
   if(step.id)outputs[step.id]=Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(line=>line.split(/=(.*)/s).slice(0,2)));
  }
  return {failure,...JSON.parse(readFileSync(state,'utf8'))};
 }finally{rmSync(fixture,{recursive:true,force:true});}
}
const base=()=>({head:sha('c'),commits:{[sha('b')]:{version:'0.4.0'},[sha('c')]:{version:'0.4.0'}},runs:{42:artifact('0.4.0')}});
it('publishes exactly the artifact from the reused tested run after a rebase merge',()=>{
 const bytes=packageBytes('0.4.0');const repo={...base(),runs:{42:receipt(7),7:artifact('0.4.0',bytes)}};const result=release(repo,sha('b'));expect(result.failure).toBeNull();expect(result.calls).toEqual(['npm '+integrity(bytes).slice(7),`release afbin-v0.4.0 ${sha('b')}`]);
});
it('does nothing when no npm artifact was built or a newer release superseded it',()=>{
 for(const repo of [{...base(),runs:{}},{...base(),runs:{42:receipt(9),9:{}}},{...base(),commits:{[sha('b')]:{version:'0.4.0'},[sha('c')]:{version:'0.4.1'}}}]){const result=release(repo,sha('b'));expect(result.failure).toBeNull();expect(result.calls).toEqual([]);}
});
it('rejects mismatched manifest, absent lock, copied native dependencies and release pointer before publishing',()=>{
 const bad=[packageBytes('0.3.9'),packageBytes('0.4.0',{name:'wrong'}),packageBytes('0.4.0',{noLock:true}),packageBytes('0.4.0',{native:true})];
 for(const bytes of bad){const result=release({...base(),runs:{42:artifact('0.4.0',bytes)}},sha('b'));expect(result.failure).not.toBeNull();expect(result.calls).toEqual([]);}
 const result=release({...base(),commits:{...base().commits,[sha('b')]:{version:'0.4.0',pointer:'0.3.9'}}},sha('b'));expect(result.failure).not.toBeNull();expect(result.calls).toEqual([]);
});
it('requires an existing immutable npm version to contain the identical tested bytes',()=>{
 const bytes=packageBytes('0.4.0');const repo={...base(),runs:{42:artifact('0.4.0',bytes)},published:{'0.4.0':integrity(bytes)}};const identical=release(repo,sha('b'));expect(identical.failure).toBeNull();expect(identical.calls).toEqual([`release afbin-v0.4.0 ${sha('b')}`]);
 const different=release({...repo,published:{'0.4.0':'sha512-wrong'}},sha('b'));expect(different.failure).toMatch(/different bytes/);expect(different.calls).toEqual([]);
});
it('leaves an existing published GitHub release alone and recovers an incomplete draft',()=>{
 const bytes=packageBytes('0.4.0');const repo={...base(),runs:{42:artifact('0.4.0',bytes)},published:{'0.4.0':integrity(bytes)}};
 const published=release({...repo,releases:{'afbin-v0.4.0':{draft:false}}},sha('b'));expect(published.failure).toBeNull();expect(published.calls).toEqual([]);
 const draft=release({...repo,releases:{'afbin-v0.4.0':{draft:true}}},sha('b'));expect(draft.failure).toBeNull();expect(draft.calls).toEqual(['upload afbin-v0.4.0','finish afbin-v0.4.0']);
});
it('fails a registry outage without mistaking it for a missing version to publish',()=>{const result=release({...base(),registryError:true},sha('b'));expect(result.failure).toMatch(/E500/);expect(result.calls).toEqual([]);});
