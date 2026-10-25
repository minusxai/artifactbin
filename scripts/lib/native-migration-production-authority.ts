import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {readFile,writeFile,mkdir,realpath} from 'node:fs/promises';
import path from 'node:path';
import {preparedPilotStoreDigest as digest} from './native-prepared-pilot-store.mjs';
import {readNativeMigrationHostInputs} from './native-migration-host.mjs';
import type {NativeProductionAuthorityInput,NativeProductionAuthorityPrepared} from './native-migration-production-authority-contract';
import type {NativeHostContext} from './native-migration-host-contract';
import type {NativeProductionPlan} from './native-migration-production-contract';
const sha=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const fail=():never=>{throw Error('native_production_authority_binding');};
const json=(bytes:Uint8Array)=>JSON.parse(Buffer.from(bytes).toString());
/** No target access: replace only explicitly reviewed operator authority. */
export function prepareNativeProductionAuthority(input:NativeProductionAuthorityInput):NativeProductionAuthorityPrepared {
 const {context,recipe,files,plan,origin,globalIdentity}=input,{sha256,...payload}=plan;
 const selected=plan.heads.filter(head=>isDeepStrictEqual(head.key,context.revision.key));
 if(plan.format!=='native-production-plan-v1'||plan.revisionScope!=='latest'||sha256!==digest(payload)||selected.length!==1||!isDeepStrictEqual(recipe.key,context.revision.key)||!isDeepStrictEqual(context.assembly.key,recipe.key)||recipe.assemblySha256!==context.assembly.sha256||recipe.revisionScope!=='latest'||selected[0]!.canonicalSha256!==sha(files.sourceHead)||sha(files.compiledHtml)!==context.assembly.result.htmlSha256||!Buffer.from(files.identity).equals(Buffer.from(globalIdentity))||sha(globalIdentity)!==plan.identity.sha256)fail();
 if(plan.runtimeAuthority?.mode!=='scoped-internal-tokens'||!Number.isSafeInteger(plan.runtimeAuthority.ttlMs)||plan.runtimeAuthority.ttlMs<=0||sha(origin)!==plan.target.originSha256)fail();
 if(Object.keys(files).sort().join()!==Object.keys(recipe.inputs).sort().join()||plan.ancillaryFolders&&(!input.globalAncillary||sha(input.globalAncillary)!==plan.ancillaryFolders.sha256||!files.ancillaryFolders||!Buffer.from(files.ancillaryFolders).equals(Buffer.from(input.globalAncillary))))fail();
 const authority=plan.runtimeAuthority!;
 const parsed=(()=>{try{return new URL(origin);}catch{return fail();}})();if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)fail();
 const schemas={appSchema:plan.target.appSchema,authSchema:plan.target.authSchema};if(!Object.values(schemas).every(value=>/^[a-z_][a-z0-9_]{0,62}$/.test(value))||schemas.appSchema===schemas.authSchema)fail();
 const identity=json(files.identity),source=json(files.sourceHead),heads=source.heads?.filter((row:{id:string;version:number})=>row.id===recipe.key.sourceId&&row.version===recipe.key.version);
 if(identity.approvedPlanSha256!==identity.plan?.sha256||identity.plan.sourceNamespace!==plan.sourceNamespace||heads?.length!==1)fail();
 const userId=identity.plan.targets.users[heads[0].user_id]?.userId,before=json(files.authSchemaCapability),previous=before.runtime;
 if(!userId||previous?.actor?.userId!==userId||typeof previous.actor.tokenId!=='string'||!previous.actor.tokenId||typeof previous.origin!=='string'||!isDeepStrictEqual(before.schemas,{appSchema:recipe.authority.appSchema,authSchema:recipe.authority.authSchema}))fail();
 const transformed=structuredClone(files),capability={...before,schemas,runtime:{...previous,origin,actor:{userId},authority:{mode:authority.mode,ttlMs:authority.ttlMs}}};
 transformed.authSchemaCapability=Buffer.from(JSON.stringify(capability));
 const derived=structuredClone(recipe),preserved:Record<string,string>={};
 for(const name of Object.keys(files) as (keyof typeof files)[]){const bytes=transformed[name]!;if(!bytes)fail();const currentSha=sha(bytes);if(name!=='authSchemaCapability'){if(currentSha!==recipe.inputs[name]!.sha256||!Buffer.from(bytes).equals(Buffer.from(files[name]!)))fail();preserved[name]=currentSha;}derived.inputs[name]={path:name+'.input',sha256:currentSha};}
 derived.authority={...derived.authority,...schemas};
 return {recipe:derived,files:transformed,diff:{format:'native-production-authority-diff-v1',planSha256:plan.sha256,key:structuredClone(recipe.key),assemblySha256:recipe.assemblySha256,preservedInputSha256:preserved,schemas:{before:{appSchema:recipe.authority.appSchema,authSchema:recipe.authority.authSchema},after:schemas},origin:{beforeSha256:sha(previous.origin),afterSha256:sha(origin)},actor:{userId,previousTokenIdSha256:sha(previous.actor.tokenId),afterAuthority:'scoped-internal-tokens',ttlMs:authority.ttlMs},sourceAndTargetRevisionsPreserved:true,imported:false,comparisonAdmitted:false,productionWrites:0}};
}
/** Independently reject any extra evidence, key, revision, capability or actor mutation. */
export function verifyNativeProductionAuthorityBinding(input:NativeProductionAuthorityInput,prepared:NativeProductionAuthorityPrepared):void {
 const expected=prepareNativeProductionAuthority(input);
 if(!isDeepStrictEqual(expected.recipe,prepared.recipe)||!isDeepStrictEqual(expected.diff,prepared.diff)||Object.keys(expected.files).length!==Object.keys(prepared.files).length)fail();
 for(const name of Object.keys(expected.files) as (keyof typeof expected.files)[])if(!prepared.files[name]||!Buffer.from(expected.files[name]!).equals(Buffer.from(prepared.files[name]!)))fail();
}
/** Materialize a new immutable private receipt root, retaining genuine evidence elsewhere unchanged. */
export async function materializeNativeProductionAuthority(options:{context:NativeHostContext;plan:NativeProductionPlan;planReceiptRoot:string;origin:string;outputDirectory:string}) {
 const scope=structuredClone(options);
 const admitted=await readNativeMigrationHostInputs(scope.context),root=await realpath(scope.planReceiptRoot),identityPath=await realpath(path.resolve(root,scope.plan.identity.path));
 if(path.isAbsolute(scope.plan.identity.path)||!identityPath.startsWith(root+path.sep))fail();
 let globalAncillary:Uint8Array|undefined;if(scope.plan.ancillaryFolders){const ref=scope.plan.ancillaryFolders,filename=await realpath(path.resolve(root,ref.path));if(path.isAbsolute(ref.path)||!filename.startsWith(root+path.sep))fail();globalAncillary=new Uint8Array(await readFile(filename));}
 const input={...admitted,plan:scope.plan,globalIdentity:new Uint8Array(await readFile(identityPath)),globalAncillary,origin:scope.origin},prepared=prepareNativeProductionAuthority(input);
 verifyNativeProductionAuthorityBinding(input,prepared);await mkdir(scope.outputDirectory,{recursive:true,mode:0o700});
 for(const [name,bytes] of Object.entries(prepared.files))await writeFile(path.join(scope.outputDirectory,name+'.input'),bytes!,{flag:'wx',mode:0o600});
 const authorityRecipePath=path.join(scope.outputDirectory,'authority-recipe.json'),verificationPath=path.join(scope.outputDirectory,'authority-diff.json');
 await writeFile(authorityRecipePath,JSON.stringify(prepared.recipe),{flag:'wx',mode:0o600});await writeFile(verificationPath,JSON.stringify(prepared.diff),{flag:'wx',mode:0o600});
 return {context:{...scope.context,receiptRoot:scope.outputDirectory,authorityRecipePath},verificationPath,diff:prepared.diff};
}
