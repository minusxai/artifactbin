import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parse} from 'yaml';
import {npmDriver} from '../ci/npm-driver.mjs';
import {describe,it,expect} from 'vitest';
import {artifactSubject,inspectBundle,signArtifact} from '../ci/npm-provenance.mjs';
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
  const invoke=extra=>spawnSync(process.execPath,[npmDriver(),'publish',fixture,...extra,'--dry-run','--json','--offline','--registry','http://127.0.0.1:1','--userconfig',config],{cwd:fixture,encoding:'utf8',timeout:15000,env:{...process.env,npm_config_cache:join(fixture,'cache')}});
  // npm's real CLI rejects even false when both mutually exclusive config keys are present.
  const incompatible=invoke(['--access','public','--provenance=false','--provenance-file',provenance,'--ignore-scripts']);
  expect(incompatible.status).not.toBe(0);expect(incompatible.stderr).toMatch(/provenance-file.*can not be provided when using --provenance/);
  const actual=invoke(args);expect(actual.status,actual.stderr).toBe(0);expect(JSON.parse(actual.stdout).name).toBe('@afbin/cli-publish-argument-test');
 }finally{rmSync(fixture,{recursive:true,force:true});}
});
