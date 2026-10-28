import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parse} from 'yaml';
import {npmDriver} from '../ci/npm-driver.mjs';
import {describe,it,expect} from 'vitest';
import {artifactSubject,inspectBundle,signArtifact,withRekorConflictRecovery} from '../ci/npm-provenance.mjs';
const bytes=Buffer.from('the actual tested tarball');
const subject={name:'pkg:npm/%40afbin/cli@0.4.0',digest:{sha512:createHash('sha512').update(bytes).digest('hex')}};
const context={GITHUB_REPOSITORY:'minusxai/artifactbin',GITHUB_REPOSITORY_VISIBILITY:'public',GITHUB_EVENT_NAME:'pull_request',AFBIN_HEAD_REPOSITORY:'minusxai/artifactbin',GITHUB_SHA:'a'.repeat(40),AFBIN_HEAD_SHA:'c'.repeat(40),GITHUB_RUN_ID:'17',GITHUB_RUN_ATTEMPT:'2',GITHUB_WORKFLOW_REF:'minusxai/artifactbin/.github/workflows/ci.yml@refs/pull/12/merge'};
function bundle(changes={}){return {dsseEnvelope:{payload:Buffer.from(JSON.stringify({_type:'https://in-toto.io/Statement/v1',subject:[subject],predicateType:'https://slsa.dev/provenance/v1',predicate:{buildDefinition:{externalParameters:{workflow:{repository:'https://github.com/minusxai/artifactbin',path:'.github/workflows/ci.yml',ref:'refs/pull/12/merge'}},resolvedDependencies:[{uri:'git+https://github.com/minusxai/artifactbin@refs/pull/12/merge',digest:{gitCommit:context.GITHUB_SHA}}]},runDetails:{metadata:{invocationId:'https://github.com/minusxai/artifactbin/actions/runs/17/attempts/2'}}},...changes})).toString('base64'),payloadType:'application/vnd.in-toto+json',signatures:[{sig:'fixture'}]},verificationMaterial:{}};}
describe('tested npm artifact provenance boundary',()=>{
 it('uses npm package-url and SHA512 of the exact tarball bytes',()=>expect(artifactSubject('0.4.0',bytes)).toEqual(subject));
 it('checks name, hash, source commit and actual build run before registry admission',()=>{
  expect(inspectBundle(bundle(),'0.4.0',bytes,{sha:context.GITHUB_SHA,run:'17'})).toEqual(subject);
  for(const value of [null,{},bundle({subject:[]}),bundle({subject:[{...subject,name:'pkg:npm/other@0.4.0'}]}),bundle({subject:[{...subject,digest:{sha512:'0'.repeat(128)}}]})])expect(()=>inspectBundle(value,'0.4.0',bytes,{sha:context.GITHUB_SHA,run:'17'})).toThrow();
  for(const expected of [{sha:'b'.repeat(40),run:'17'},{sha:context.GITHUB_SHA,run:'42'}])expect(()=>inspectBundle(bundle(),'0.4.0',bytes,expected)).toThrow();
 });
 it('refuses unrelated repositories, fork PRs and private repository signing',async()=>{
  for(const env of [{...context,GITHUB_REPOSITORY:'other/repo'},{...context,AFBIN_HEAD_REPOSITORY:'fork/artifactbin'},{...context,GITHUB_REPOSITORY_VISIBILITY:'private'}])await expect(signArtifact('0.4.0',bytes,env,{})).rejects.toThrow();
 });
 it('makes one fresh official signing attempt only for a duplicate Rekor entry',async()=>{
  for(const length of [64,80]){
   const duplicate=Object.assign(new Error('duplicate transparency entry'),{code:'TLOG_CREATE_ENTRY_ERROR',cause:{statusCode:409,location:'/api/v1/log/entries/'+'a'.repeat(length)}});
   const signed=bundle(),calls=[];
   const result=await signArtifact('0.4.0',bytes,context,{
    generateProvenance:async(subjects,options)=>{calls.push({subjects,options});if(calls.length===1)throw duplicate;return signed;},
    verifyProvenance:async(expected,file)=>{calls.push({expected,bundle:JSON.parse(readFileSync(file,'utf8'))});return signed;},
   });
   expect(result).toBe(signed);
   expect(calls).toEqual([{subjects:[subject],options:{}},{subjects:[subject],options:{}},{expected:subject,bundle:signed}]);
  }
 });
 it('fails closed when the one fresh signing attempt also conflicts',async()=>{
  const first=Object.assign(new Error('first duplicate'),{code:'TLOG_CREATE_ENTRY_ERROR',cause:{statusCode:409,location:'/api/v1/log/entries/'+'a'.repeat(80)}});
  const second=Object.assign(new Error('second duplicate'),{code:'TLOG_CREATE_ENTRY_ERROR',cause:{statusCode:409,location:'/api/v1/log/entries/'+'b'.repeat(80)}});
  let generated=0,verified=0;
  await expect(signArtifact('0.4.0',bytes,context,{generateProvenance:async()=>{throw ++generated===1?first:second;},verifyProvenance:async()=>{verified++;}})).rejects.toBe(second);
  expect(generated).toBe(2);expect(verified).toBe(0);
 });
 it('never retries unrelated failures or invalid duplicate entry locations',async()=>{
  const location='/api/v1/log/entries/'+'a'.repeat(80);
  const cases=[{code:'OTHER_ERROR',cause:{statusCode:409,location}},{code:'TLOG_CREATE_ENTRY_ERROR'},
   ...[400,500,'409'].map(statusCode=>({code:'TLOG_CREATE_ENTRY_ERROR',cause:{statusCode,location}})),
   ...['https://rekor.sigstore.dev'+location,'//rekor.sigstore.dev'+location,location+'?x=1',location+'#x',location+'/',
    '/other/'+'a'.repeat(80),'/api/v1/log/entries/'+'a'.repeat(63),'/api/v1/log/entries/'+'a'.repeat(65),
    '/api/v1/log/entries/'+'a'.repeat(79),'/api/v1/log/entries/'+'a'.repeat(81),'/api/v1/log/entries/'+'z'.repeat(80),null]
    .map(value=>({code:'TLOG_CREATE_ENTRY_ERROR',cause:{statusCode:409,location:value}}))];
  for(const detail of cases){
   const error=Object.assign(new Error('signing failed'),detail);let generated=0,verified=0;
   await expect(signArtifact('0.4.0',bytes,context,{generateProvenance:async()=>{generated++;throw error;},verifyProvenance:async()=>{verified++;}})).rejects.toBe(error);
   expect(generated).toBe(1);expect(verified).toBe(0);
  }
 });
 it('still checks subject/build identity and requires signature verification after a fresh signing attempt',async()=>{
  const duplicate=Object.assign(new Error('duplicate'),{code:'TLOG_CREATE_ENTRY_ERROR',cause:{statusCode:409,location:'/api/v1/log/entries/'+'a'.repeat(64)}});
  const mismatched=change=>{const result=bundle();const statement=JSON.parse(Buffer.from(result.dsseEnvelope.payload,'base64').toString());change(statement);result.dsseEnvelope.payload=Buffer.from(JSON.stringify(statement)).toString('base64');return result;};
  const cases=[[bundle({subject:[]}), 'Provenance subject'],[bundle({subject:[{...subject,digest:{sha512:'0'.repeat(128)}}]}),'Provenance subject'],
   [mismatched(statement=>{statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit='b'.repeat(40);}), 'actual afbin build source'],
   [mismatched(statement=>{statement.predicate.runDetails.metadata.invocationId='https://github.com/minusxai/artifactbin/actions/runs/42/attempts/2';}), 'selected build run']];
  for(const [invalid,reason] of cases){
   let generated=0,verified=0;
   await expect(signArtifact('0.4.0',bytes,context,{generateProvenance:async()=>{if(++generated===1)throw duplicate;return invalid;},verifyProvenance:async()=>{verified++;}})).rejects.toThrow(reason);
   expect(generated).toBe(2);expect(verified).toBe(0);
  }
  let generated=0,verified=0;
  await expect(signArtifact('0.4.0',bytes,context,{generateProvenance:async()=>{if(++generated===1)throw duplicate;return bundle();},verifyProvenance:async()=>{verified++;throw Error('untrusted signature');}})).rejects.toThrow('untrusted signature');
  expect(generated).toBe(2);expect(verified).toBe(1);
 });
 it('uses the official signer and verifies its result without substituting build identity',async()=>{
  const calls=[];const signed=bundle();const result=await signArtifact('0.4.0',bytes,context,{generateProvenance:async subjects=>{calls.push(subjects);return signed;},verifyProvenance:async expected=>{calls.push(expected);return signed;}});
  expect(result).toBe(signed);expect(calls).toEqual([[subject],subject]);
  await expect(signArtifact('0.4.0',bytes,context,{generateProvenance:async()=>signed,verifyProvenance:async()=>{throw Error('untrusted signature');}})).rejects.toThrow('untrusted signature');
 });
});

it('accepts the actual workflow publish arguments through npm CLI without conflicting provenance flags',()=>{
 const fixture=mkdtempSync(join(tmpdir(),'afbin-publish-args-'));
 try{
  writeFileSync(join(fixture,'package.json'),JSON.stringify({name:'@afbin/cli-publish-argument-test',version:'0.0.0'}));
  const provenance=join(fixture,'bundle.sigstore');writeFileSync(provenance,'{}');
  const config=join(fixture,'empty.npmrc');writeFileSync(config,'');
  const definition=parse(readFileSync(resolve(import.meta.dirname,'../../.github/workflows/release-cli.yml'),'utf8'));
  const command=definition.jobs.release.steps.find(step=>step.id==='publish').run.match(/^\s*npm publish "\$PACKAGE_FILE" (.+)$/m)[1];
  const args=command.match(/"[^"]*"|\S+/g).map(value=>value.replace(/^"|"$/g,'').replace('$PACKAGE_FILE.sigstore',provenance));
  const invoke=(extra,source=fixture)=>spawnSync(process.execPath,[npmDriver(),'publish',source,...extra,'--dry-run','--json','--offline','--registry','http://127.0.0.1:1','--userconfig',config],{cwd:fixture,encoding:'utf8',timeout:15000,env:{...process.env,npm_config_cache:join(fixture,'cache')}});
  // npm's real CLI rejects even false when both mutually exclusive config keys are present.
  const incompatible=invoke(['--access','public','--provenance=false','--provenance-file',provenance,'--ignore-scripts']);
  expect(incompatible.status).not.toBe(0);expect(incompatible.stderr).toMatch(/provenance-file.*can not be provided when using --provenance/);
  const actual=invoke(args);expect(actual.status,actual.stderr).toBe(0);expect(JSON.parse(actual.stdout).name).toBe('@afbin/cli-publish-argument-test');
  // Exercise the workflow's actual tarball argument: an unprefixed `package/file.tgz`
  // is parsed by npm as a GitHub shorthand instead of a local package.
  mkdirSync(join(fixture,'package'));
  mkdirSync(join(fixture,'contents/package'),{recursive:true});
  writeFileSync(join(fixture,'contents/package/package.json'),readFileSync(join(fixture,'package.json')));
  const selection=definition.jobs.release.steps.find(step=>step.id==='package').run;
  const source=selection.match(/^\s*file="([^"]+)"$/m)[1].replace('$version','0.0.0');
  const packed=spawnSync('tar',['-czf',join(fixture,source),'-C',join(fixture,'contents'),'package'],{encoding:'utf8'});
  expect(packed.status,packed.stderr).toBe(0);
  const tarball=invoke(args,source);expect(tarball.status,tarball.stderr).toBe(0);
  expect(JSON.parse(tarball.stdout).name).toBe('@afbin/cli-publish-argument-test');
 }finally{rmSync(fixture,{recursive:true,force:true});}
});

it('recovers the original signed entry through the pinned official witness and restores its factory', async () => {
 const original = () => ({ witnesses: [{ tlog: { fetchOnConflict: false, rekor: { getEntry: async uuid => ({ uuid }) } } }] });
 const config = { createBundleBuilder: original };
 const result = await withRekorConflictRecovery(config, async () => {
  const builder = config.createBundleBuilder('dsseEnvelope', {});
  expect(builder.witnesses[0].tlog.fetchOnConflict).toBe(true);
  return builder.witnesses[0].tlog.rekor.getEntry('a'.repeat(80));
 });
 expect(result).toEqual({ uuid: 'a'.repeat(80) });
 expect(config.createBundleBuilder).toBe(original);
 await expect(withRekorConflictRecovery(config, async () => config.createBundleBuilder('dsseEnvelope', {}).witnesses[0].tlog.rekor.getEntry('https://evil.invalid/entry'))).rejects.toThrow('Invalid Rekor entry identity');
 expect(config.createBundleBuilder).toBe(original);
 await expect(withRekorConflictRecovery(config, async () => { throw Error('signing failed'); })).rejects.toThrow('signing failed');
 expect(config.createBundleBuilder).toBe(original);
});
it('fails visibly if the pinned witness boundary changes', async () => {
 const original = () => ({ witnesses: [] });
 const config = { createBundleBuilder: original };
 await expect(withRekorConflictRecovery(config, async () => config.createBundleBuilder('dsseEnvelope', {}))).rejects.toThrow('Pinned Rekor witness changed');
 expect(config.createBundleBuilder).toBe(original);
});
