/** Execute the npm publisher's actual shell steps against isolated GitHub/npm fixtures. */
import {spawnSync} from 'node:child_process';
import {chmodSync,cpSync,existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
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
  const directory=join(fixture,'package');mkdirSync(directory);writeFileSync(join(directory,'package.json'),JSON.stringify({name:options.name??'@afbin/cli',version}));
  if(!options.noLock)writeFileSync(join(directory,'npm-shrinkwrap.json'),'{}');
  if(options.native){mkdirSync(join(directory,'dist/runtime/node_modules/sharp'),{recursive:true});writeFileSync(join(directory,'dist/runtime/node_modules/sharp/native.node'),'build-machine');}
  const file=join(fixture,'package.tgz');const packed=spawnSync('tar',['-czf',file,'-C',fixture,'package'],{encoding:'utf8'});if(packed.status!==0)throw Error(packed.stderr);
  return readFileSync(file);
 }finally{rmSync(fixture,{recursive:true,force:true});}
}
/** The checked-out tree the transition verifier reads: its own script, the package version, the protocol and the pinned bootstrap. */
function transitionTree(directory,version){
 mkdirSync(join(directory,'services/cli/scripts'),{recursive:true});mkdirSync(join(directory,'services/cli/transition'),{recursive:true});mkdirSync(join(directory,'services/contracts/src'),{recursive:true});
 cpSync(join(root,'services/cli/scripts/transition-assets.mjs'),join(directory,'services/cli/scripts/transition-assets.mjs'));
 writeFileSync(join(directory,'services/cli/package.json'),JSON.stringify({name:'@afbin/cli',version}));
 writeFileSync(join(directory,'services/contracts/src/cli-auth.ts'),'export const CLI_PROTOCOL_VERSION = 3;\n');
 writeFileSync(join(directory,'services/cli/transition/afbin'),readFileSync(join(root,'services/cli/transition/afbin'),'utf8').replace(/^AFBIN_VERSION=.*$/m,`AFBIN_VERSION=${version}`).replace(/^AFBIN_PROTOCOL=.*$/m,'AFBIN_PROTOCOL=3'),{mode:0o755});
}
/** The nine files old 0.3.x installs download, built by the real builder from a stub tree. */
function transitionFiles(version){
 const fixture=mkdtempSync(join(tmpdir(),'npm-release-transition-'));
 try{
  transitionTree(fixture,version);mkdirSync(join(fixture,'services/cli/src/generated'),{recursive:true});
  writeFileSync(join(fixture,'services/cli/src/generated/teaching.json'),JSON.stringify({version,protocol:3,files:{'SKILL.md':'# artifactbin\n','references/errors.md':'__AFBIN_SERVER__/chat\n'}}));
  const out=join(fixture,'out'),built=spawnSync(process.execPath,[join(fixture,'services/cli/scripts/transition-assets.mjs'),'build',out],{encoding:'utf8'});if(built.status!==0)throw Error(built.stderr);
  return Object.fromEntries(readdirSync(out).map(name=>[`transition/${name}`,readFileSync(join(out,name)).toString('base64')]));
 }finally{rmSync(fixture,{recursive:true,force:true});}
}
const TRANSITION=[...['darwin-arm64','darwin-x64','linux-arm64','linux-x64'].flatMap(target=>[`afbin-${target}`,`afbin-${target}.manifest.json`]),'afbin-skills.json'];
function artifact(version,bytes=packageBytes(version),run='42',source=sha('b'),head=source){
 const statement={_type:'https://in-toto.io/Statement/v1',subject:[{name:`pkg:npm/%40afbin/cli@${version}`,digest:{sha512:createHash('sha512').update(bytes).digest('hex')}}],predicateType:'https://slsa.dev/provenance/v1',predicate:{buildDefinition:{externalParameters:{workflow:{repository:'https://github.com/minusxai/artifactbin',path:'.github/workflows/ci.yml',ref:'refs/pull/12/merge'}},resolvedDependencies:[{uri:'git+https://github.com/minusxai/artifactbin@refs/heads/main',digest:{gitCommit:source}}]},runDetails:{metadata:{invocationId:`https://github.com/minusxai/artifactbin/actions/runs/${run}/attempts/1`}}}};
 const bundle={dsseEnvelope:{payload:Buffer.from(JSON.stringify(statement)).toString('base64'),signatures:[{sig:'fixture-signature'}]},verificationMaterial:{}};
 return {'afbin-npm-release':{[`afbin-cli-${version}.tgz`]:bytes.toString('base64'),[`afbin-cli-${version}.tgz.sigstore`]:Buffer.from(JSON.stringify(bundle)).toString('base64'),[`afbin-cli-${version}.tgz.build.json`]:Buffer.from(JSON.stringify({run_id:run,source_sha:source,head_sha:head})).toString('base64'),...transitionFiles(version)}};
}
const receipt=id=>({'tested-run':{'tested-run.json':Buffer.from(JSON.stringify({run_id:id})).toString('base64')}});
const GH=String.raw`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),crypto=require('node:crypto');
const file=process.env.RELEASE_STATE,state=JSON.parse(fs.readFileSync(file)),args=process.argv.slice(2),flag=name=>args[args.indexOf(name)+1];
const save=()=>fs.writeFileSync(file,JSON.stringify(state)),fail=message=>{console.error(message);process.exit(1)},answer=value=>{const jq=args.includes('--jq')?flag('--jq'):null;if(!jq){console.log(JSON.stringify(value));process.exit(0);}const result=spawnSync('jq',['-r',jq],{input:JSON.stringify(value),encoding:'utf8'});process.stdout.write(result.stdout);process.exit(result.status);};
if(args[0]==='api'){
 const route=args.find(a=>a.startsWith('repos/')).replace(/^repos\/[^/]+\/[^/]+\//,'');
 if(route==='git/ref/heads/main')answer({object:{sha:state.head}});
 if(route.startsWith('contents/')){const commit=state.commits[route.split('ref=')[1]];if(!commit)fail('HTTP 404');const value={version:route.includes('release.json')?(commit.pointer??commit.version):commit.version};answer({content:Buffer.from(JSON.stringify(value)).toString('base64')});}
 const build=/^actions\/runs\/(\d+)$/.exec(route);if(build)answer({head_sha:state.buildSources?.[build[1]]??'b'.repeat(40),conclusion:'success',event:'push',head_branch:'main',path:'.github/workflows/ci.yml',head_repository:{full_name:'minusxai/artifactbin'},...state.runMetadata?.[build[1]]});
 const run=/actions\/runs\/(\d+)\/artifacts/.exec(route);if(run)answer({artifacts:Object.keys(state.runs[run[1]]??{}).map(name=>({name,expired:false}))});
}
if(args[0]==='run'&&args[1]==='download'){const files=state.runs[args[2]]?.[flag('--name')];if(!files)fail('No artifact');fs.mkdirSync(flag('--dir'),{recursive:true});for(const [name,data]of Object.entries(files)){const target=path.join(flag('--dir'),name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,Buffer.from(data,'base64'));}process.exit(0);}
const assets=()=>{const end=args.findIndex((a,i)=>i>2&&a.startsWith('--'));return args.slice(3,end).map(file=>{if(!fs.existsSync(file))fail('Missing asset '+file);return path.basename(file);});};
if(args[0]==='release'&&args[1]==='view'){if(!state.releases[args[2]])fail('HTTP 404');answer({isDraft:state.releases[args[2]].draft});}
if(args[0]==='release'&&args[1]==='create'){state.assets[args[2]]=assets();state.calls.push('release '+args[2]+' '+flag('--target'));state.releases[args[2]]={draft:false};save();process.exit(0);}
if(args[0]==='release'&&args[1]==='upload'){state.assets[args[2]]=assets();state.calls.push('upload '+args[2]);save();process.exit(0);}
if(args[0]==='release'&&args[1]==='edit'){state.calls.push('finish '+args[2]);state.releases[args[2]]={draft:false};save();process.exit(0);}
fail('Unexpected gh '+args.join(' '));
`;
const NPM=String.raw`#!${process.execPath}
const fs=require('node:fs'),crypto=require('node:crypto'),file=process.env.RELEASE_STATE,state=JSON.parse(fs.readFileSync(file)),args=process.argv.slice(2);
if(args[0]==='view'){if(state.registryError){console.error('E500 registry unavailable');process.exit(1);}if(args[1]==='@afbin/cli'){if(state.packageAbsent){console.error('E404 package absent');process.exit(1);}console.log('@afbin/cli');process.exit(0);}const version=args[1].split('@').at(-1),published=state.published[version];if(!published){console.error('E404 version absent');process.exit(1);}console.log(args[2]==='version'?version:published);process.exit(0);}
if(args[0]==='publish'){if(args.some(arg=>/^--provenance(?:=|$)/.test(arg)))throw Error('Conflicting provenance flags');for(const flag of ['--access','--provenance-file','--ignore-scripts'])if(!args.includes(flag))throw Error('Unsafe publish arguments');const bytes=fs.readFileSync(args[1]);state.calls.push('npm '+crypto.createHash('sha512').update(bytes).digest('base64'));fs.writeFileSync(file,JSON.stringify(state));process.exit(0);}
throw Error('Unexpected npm '+args.join(' '));
`;
function release(repo,source,event='workflow_run',requestedRun='42'){
 const fixture=mkdtempSync(join(tmpdir(),'npm-release-flow-'));
 try{
  const state=join(fixture,'state.json');writeFileSync(state,JSON.stringify({releases:{},runs:{},published:{},calls:[],assets:{},...repo}));mkdirSync(join(fixture,'bin'));for(const [name,code]of [['gh',GH],['npm',NPM]]){const file=join(fixture,'bin',name);writeFileSync(file,code);chmodSync(file,0o755);}
  mkdirSync(join(fixture,'scripts/ci'),{recursive:true});for(const file of ['npm-provenance.mjs','npm-driver.mjs'])cpSync(join(root,'scripts/ci',file),join(fixture,'scripts/ci',file));
  transitionTree(fixture,repo.checkout??'0.4.0');
  // Mock only npm's official crypto boundary. Real carrier/source checks and shell run below.
  const fakeNpm=join(fixture,'fixture-npm');mkdirSync(join(fakeNpm,'bin'),{recursive:true});mkdirSync(join(fakeNpm,'node_modules/libnpmpublish/lib'),{recursive:true});mkdirSync(join(fakeNpm,'node_modules/sigstore'),{recursive:true});
  writeFileSync(join(fakeNpm,'package.json'),JSON.stringify({version:'11.19.0'}));writeFileSync(join(fakeNpm,'bin/npm-cli.js'),'');
  writeFileSync(join(fakeNpm,'node_modules/libnpmpublish/lib/provenance.js'),`exports.verifyProvenance=async(subject,file)=>{const bundle=JSON.parse(require('node:fs').readFileSync(file));if(bundle.dsseEnvelope.signatures[0].sig!=='fixture-signature')throw Error('Untrusted fixture signature');return bundle;};`);
  writeFileSync(join(fakeNpm,'node_modules/sigstore/index.js'),`exports.verify=async(bundle,options)=>{if(options.certificateIssuer!=='https://token.actions.githubusercontent.com'||options.certificateIdentityURI!=='https://github.com/minusxai/artifactbin/.github/workflows/ci.yml@refs/pull/12/merge')throw Error('Wrong certificate identity policy');};`);
  writeFileSync(join(fixture,'scripts/ci/npm-driver.mjs'),`export function npmDriver(){return new URL('../../fixture-npm/bin/npm-cli.js',import.meta.url).pathname;}`);
  const job=workflow('release-cli.yml').jobs.release,outputs={};
  const context={'github.token':'fixture-not-secret','github.event.workflow_run.head_sha':source,'github.event.workflow_run.id':'42','github.event_name':event,'inputs.source_run':requestedRun};
  const expand=text=>String(text).replace(/\$\{\{\s*(.+?)\s*\}\}/g,(_,key)=>{const step=/^steps\.([\w-]+)\.outputs\.([\w-]+)$/.exec(key);return step?outputs[step[1]]?.[step[2]]??'':context[key];});
  const envFor=values=>Object.fromEntries(Object.entries(values??{}).map(([key,value])=>[key,expand(value)]));
  let failure=null;const messages=[];
  for(const step of job.steps){
   if(step.uses)continue;
   if(step.if){const condition=/^steps\.([\w-]+)\.outputs\.([\w-]+) != ''$/.exec(step.if);if(!outputs[condition[1]]?.[condition[2]])continue;}
   const output=join(fixture,'output');writeFileSync(output,'');const result=spawnSync('bash',['--noprofile','--norc','-eo','pipefail','-c',step.run],{cwd:fixture,encoding:'utf8',env:{...process.env,PATH:join(fixture,'bin')+':'+process.env.PATH,RELEASE_STATE:state,GITHUB_REPOSITORY:'minusxai/artifactbin',GITHUB_RUN_ID:'99',GITHUB_OUTPUT:output,...envFor(job.env),...envFor(step.env)}});
   messages.push(result.stdout,result.stderr);
   if(result.status!==0){failure=`${step.name}: ${result.stdout}${result.stderr}`;break;}
   if(step.id)outputs[step.id]=Object.fromEntries(readFileSync(output,'utf8').trim().split('\n').filter(Boolean).map(line=>line.split(/=(.*)/s).slice(0,2)));
  }
  return {failure,messages:messages.join('\n'),...JSON.parse(readFileSync(state,'utf8'))};
 }finally{rmSync(fixture,{recursive:true,force:true});}
}
const base=()=>({head:sha('c'),commits:{[sha('b')]:{version:'0.4.0'},[sha('c')]:{version:'0.4.0'}},runs:{42:artifact('0.4.0')}});
it('publishes exactly the artifact from the reused tested run after a rebase merge',()=>{
 const bytes=packageBytes('0.4.0');const repo={...base(),buildSources:{7:sha('d')},runs:{42:receipt(7),7:artifact('0.4.0',bytes,'7',sha('a'),sha('d'))}};const result=release(repo,sha('b'));expect(result.failure).toBeNull();expect(result.calls).toEqual(['npm '+integrity(bytes).slice(7),`release afbin-v0.4.0 ${sha('b')}`]);
 // The release old 0.3.x installs update from carries the tarball and the nine transition files.
 expect(result.assets['afbin-v0.4.0'].sort()).toEqual(['afbin-cli-0.4.0.tgz',...TRANSITION].sort());
});
it('allows a maintainer retry only for successful owned main push CI',()=>{
 const result=release(base(),sha('c'),'workflow_dispatch');expect(result.failure).toBeNull();
 expect(result.calls.at(-1)).toBe(`release afbin-v0.4.0 ${sha('b')}`);
 for(const metadata of [{conclusion:'failure'},{event:'pull_request'},{head_branch:'feature'},{path:'.github/workflows/other.yml'},{head_repository:{full_name:'fork/artifactbin'}}]){
  const rejected=release({...base(),runMetadata:{42:metadata}},sha('c'),'workflow_dispatch');
  expect(rejected.failure).not.toBeNull();expect(rejected.calls).toEqual([]);
 }
 const invalid=release(base(),sha('c'),'workflow_dispatch','42/other');expect(invalid.failure).not.toBeNull();expect(invalid.calls).toEqual([]);
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
 expect(draft.assets['afbin-v0.4.0'].sort()).toEqual(['afbin-cli-0.4.0.tgz',...TRANSITION].sort());
});
it('fails a registry outage without mistaking it for a missing version to publish',()=>{const result=release({...base(),registryError:true},sha('b'));expect(result.failure).toMatch(/E500/);expect(result.calls).toEqual([]);});

it('withholds a GitHub release for the first package and gives exact login/bootstrap/resume instructions',()=>{
 const result=release({...base(),packageAbsent:true},sha('b'));
 expect(result.failure).toBeNull();expect(result.calls).toEqual([]);
 expect(result.messages).toContain('gh run download 42 --repo minusxai/artifactbin --name afbin-npm-release');
 expect(result.messages).toContain('npm publish afbin-first-release/afbin-cli-0.4.0.tgz --access public --provenance-file afbin-first-release/afbin-cli-0.4.0.tgz.sigstore --ignore-scripts');
 expect(result.messages).toContain('gh run rerun 99 --repo minusxai/artifactbin');
});
it('rejects missing provenance and bundle subjects from different bytes or build runs',()=>{
 for(const alter of [files=>delete files['afbin-cli-0.4.0.tgz.sigstore'],files=>files['afbin-cli-0.4.0.tgz.sigstore']=Buffer.from('{}').toString('base64'),files=>files['afbin-cli-0.4.0.tgz']=packageBytes('0.4.0',{name:'@afbin/cli',native:true}).toString('base64')]){
  const value=artifact('0.4.0');alter(value['afbin-npm-release']);const result=release({...base(),runs:{42:value}},sha('b'));expect(result.failure).not.toBeNull();expect(result.calls).toEqual([]);
 }
 const result=release({...base(),runs:{42:artifact('0.4.0',packageBytes('0.4.0'),'7')}},sha('b'));expect(result.failure).toMatch(/Select the exact tested/);expect(result.calls).toEqual([]);
});

it('rejects a tampered signature at the official crypto boundary before first publication or release',()=>{
 const value=artifact('0.4.0'),files=value['afbin-npm-release'],key='afbin-cli-0.4.0.tgz.sigstore',bundle=JSON.parse(Buffer.from(files[key],'base64'));bundle.dsseEnvelope.signatures[0].sig='tampered';files[key]=Buffer.from(JSON.stringify(bundle)).toString('base64');
 const result=release({...base(),runs:{42:value},packageAbsent:true},sha('b'));expect(result.failure).toMatch(/Untrusted fixture signature/);expect(result.calls).toEqual([]);
});

it('refuses to publish when the transition files old installs download are missing, tampered or for another release',()=>{
 const cases=[
  files=>{for(const name of Object.keys(files))if(name.startsWith('transition/'))delete files[name];},
  files=>{delete files['transition/afbin-skills.json'];},
  files=>{files['transition/afbin-linux-x64']=Buffer.from('#!/bin/sh\necho tampered\n').toString('base64');},
 ];
 for(const alter of cases){const value=artifact('0.4.0');alter(value['afbin-npm-release']);const result=release({...base(),runs:{42:value}},sha('b'));expect(result.failure).toMatch(/transition assets/);expect(result.calls).toEqual([]);}
 const stale=release({...base(),runs:{42:artifact('0.4.0')},checkout:'0.4.1',commits:{[sha('b')]:{version:'0.4.0'},[sha('c')]:{version:'0.4.0'}}},sha('b'));
 expect(stale.failure).toMatch(/transition assets/);expect(stale.calls).toEqual([]);
});
