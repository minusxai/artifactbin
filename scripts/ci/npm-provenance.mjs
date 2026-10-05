/** Build provenance belongs to the job that packed these bytes, never the later publisher. */
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {npmDriver} from './npm-driver.mjs';
const repository='minusxai/artifactbin';
export function artifactSubject(version,bytes){
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Invalid afbin release version');
 return {name:`pkg:npm/%40afbin/cli@${version}`,digest:{sha512:createHash('sha512').update(bytes).digest('hex')}};
}
/** Carrier/identity checks; npm publish additionally verifies the signed bundle cryptographically. */
export function inspectBundle(bundle,version,bytes,expected){
 if(!/^[a-f0-9]{40}$/.test(expected.sha??'')||!/^\d+$/.test(expected.run??''))throw Error('Invalid selected build identity');
 const subject=artifactSubject(version,bytes);
 if(!bundle?.dsseEnvelope?.signatures?.length||!bundle.verificationMaterial)throw Error('Missing signed npm provenance bundle');
 const statement=JSON.parse(Buffer.from(bundle.dsseEnvelope.payload,'base64').toString('utf8'));
 if(statement._type!=='https://in-toto.io/Statement/v1'||statement.predicateType!=='https://slsa.dev/provenance/v1'||statement.subject?.length!==1||statement.subject[0]?.name!==subject.name||statement.subject[0]?.digest?.sha512!==subject.digest.sha512)throw Error('Provenance subject does not match the tested npm tarball');
 const definition=statement.predicate?.buildDefinition,workflow=definition?.externalParameters?.workflow;
 if(workflow?.repository!==`https://github.com/${repository}`||workflow.path!=='.github/workflows/ci.yml'||!/^refs\/(?:heads\/[\w./-]+|pull\/\d+\/merge)$/.test(workflow.ref??'')||definition.resolvedDependencies?.length!==1||definition.resolvedDependencies[0]?.digest?.gitCommit!==expected.sha||!definition.resolvedDependencies[0]?.uri?.startsWith(`git+https://github.com/${repository}@`))throw Error('Provenance does not identify the actual afbin build source');
 const invocation=statement.predicate?.runDetails?.metadata?.invocationId;
 if(!new RegExp(`^https://github\\.com/${repository}/actions/runs/${expected.run}/attempts/[0-9]+$`).test(invocation??''))throw Error('Provenance does not identify the selected build run');
 return subject;
}
function officialSigner(signing=true){
 // setup-node 22.22.3 bundles npm 10.9.8. This deliberate npm-internal boundary is pinned;
 // fail visibly if that toolchain changes instead of silently generating a different format.
 const npmRequire=createRequire(npmDriver());
 if(!(signing?['10.9.8']:['10.9.8','11.19.0']).includes(npmRequire('../package.json').version))throw Error('Provenance requires the pinned npm10.9.8 build or npm11.19.0 release toolchain');
 const official=npmRequire('../node_modules/libnpmpublish/lib/provenance.js');
 const sigstore=npmRequire('../node_modules/sigstore');
 return {generateProvenance:official.generateProvenance,verifyProvenance:async(subject,file)=>{
  const bundle=await official.verifyProvenance(subject,file);
  const statement=JSON.parse(Buffer.from(bundle.dsseEnvelope.payload,'base64').toString('utf8'));
  // Chain verification alone accepts other GitHub identities. Bind the certificate's
  // SAN and OIDC issuer to the owned workflow that the signed statement names.
  await sigstore.verify(bundle,{certificateIssuer:'https://token.actions.githubusercontent.com',certificateIdentityURI:`https://github.com/${repository}/.github/workflows/ci.yml@${statement.predicate.buildDefinition.externalParameters.workflow.ref}`});
  return bundle;
 }};
}
export async function signArtifact(version,bytes,env,signer){
 if(env.GITHUB_REPOSITORY!==repository||env.GITHUB_REPOSITORY_VISIBILITY!=='public'||(env.GITHUB_EVENT_NAME==='pull_request'&&env.AFBIN_HEAD_REPOSITORY!==repository)||!['push','pull_request','schedule','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)||!env.GITHUB_WORKFLOW_REF?.startsWith(`${repository}/.github/workflows/ci.yml@`)||!/^\d+$/.test(env.GITHUB_RUN_ID??'')||!/^\d+$/.test(env.GITHUB_RUN_ATTEMPT??'')||! /^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')||! /^[a-f0-9]{40}$/.test(env.AFBIN_HEAD_SHA??''))throw Error('Only the public repository CI build may sign npm provenance');
 const official=signer??officialSigner(),subject=artifactSubject(version,bytes);
 // The official helper reads the real GitHub job environment; no SHA/run overrides are made.
 const bundle=await official.generateProvenance([subject],{});
 inspectBundle(bundle,version,bytes,{sha:env.GITHUB_SHA,run:env.GITHUB_RUN_ID});
 const directory=mkdtempSync(join(tmpdir(),'afbin-provenance-'));
 try{const file=join(directory,'bundle.sigstore');writeFileSync(file,JSON.stringify(bundle));await official.verifyProvenance(subject,file);}
 finally{rmSync(directory,{recursive:true,force:true});}
 return bundle;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const [command,file,version,sha,run]=process.argv.slice(2);
 if(command==='sign'){
  writeFileSync(file+'.sigstore',JSON.stringify(await signArtifact(version,readFileSync(file),process.env))+'\n');
  // PR API head_sha is the contributor head; GITHUB_SHA is the actually tested merge.
  writeFileSync(file+'.build.json',JSON.stringify({run_id:process.env.GITHUB_RUN_ID,source_sha:process.env.GITHUB_SHA,head_sha:process.env.AFBIN_HEAD_SHA})+'\n');
 }
 else if(command==='verify'){
  const subject=inspectBundle(JSON.parse(readFileSync(file+'.sigstore','utf8')),version,readFileSync(file),{sha,run});
  await officialSigner(false).verifyProvenance(subject,file+'.sigstore');
 }
 else throw Error('Usage: npm-provenance.mjs sign <tarball> <version> | verify <tarball> <version> <build-sha> <build-run>');
}
