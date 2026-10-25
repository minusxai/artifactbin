import {readFile,stat,realpath} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {preparedPilotStoreDigest as digest} from './native-prepared-pilot-store.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{throw Error('native_production_cli_'+code);};
/** @returns {Promise<{config:import('./native-migration-production-cli-contract').NativeProductionCliConfiguration,env:Record<string,string>,publication:{path:string,bytes:Buffer},publicationConfig:unknown,codec:undefined|{path:string,bytes:Buffer}}>}
 * Config is admitted before loading any product config singleton or opening a target. */
export async function readNativeProductionCliConfiguration(configPath){
 const file=await realpath(configPath),root=path.dirname(file),mode=(await stat(file)).mode;
 if(mode&0o077)fail('private_mode');
 const config=JSON.parse(await readFile(file,'utf8')),{sha256,...body}=config;
 if(config.format!=='native-production-cli-v1'||sha256!==digest(body))fail('config');
 const read=async(ref,privateFile=false)=>{if(!ref||typeof ref.path!=='string'||!/^[a-f0-9]{64}$/.test(ref.sha256))fail('reference');const target=await realpath(path.resolve(root,ref.path));if(privateFile&&(await stat(target)).mode&0o077)fail('private_mode');const bytes=await readFile(target);if(sha(bytes)!==ref.sha256)fail('digest');return {path:target,bytes};};
 const env=JSON.parse((await read(config.runtimeEnvironment,true)).bytes.toString());
 if(Object.keys(env).some(key=>!['DATABASE_URL','S3_URL','AUTH__SECRET','NODE_ENV'].includes(key))||typeof env.DATABASE_URL!=='string'||typeof env.S3_URL!=='string'||!/^postgres(?:ql)?:/.test(env.DATABASE_URL)||env.NODE_ENV&&env.NODE_ENV!=='production')fail('environment');
 const publication=await read(config.publication?.module),publicationConfig=JSON.parse((await read(config.publication?.configuration)).bytes.toString());
 const codec=config.contextCodec?await read(config.contextCodec):undefined;
 let origin;try{origin=new URL(config.runtimeOrigin);}catch{fail('origin');}if(!['https:','http:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash)fail('origin');
 for(const key of ['planPath','batchPath','receiptRoot','outputDirectory'])if(typeof config[key]!=='string'||!config[key])fail('paths');
 return {config:{...config,...Object.fromEntries(['planPath','batchPath','receiptRoot','outputDirectory'].map(key=>[key,path.resolve(root,config[key])]))},env,publication,publicationConfig,codec};
}
/** Injectable loader is a test boundary; the executable always uses the concrete operator below. */
export async function runNativeProductionCli({configPath,apply=false,approvedPlanSha256,approvedConfigSha256},loadRuntime=loadProductionRuntime){
 const admitted=await readNativeProductionCliConfiguration(configPath);
 if(apply&&approvedConfigSha256!==admitted.config.sha256)fail('config_approval_required');
 process.env.NODE_ENV='production';
 for(const [key,value] of Object.entries(admitted.env))process.env[key]=value;
 const runtime=await loadRuntime(admitted);
 return runtime.run({...admitted.config,apply,approvedPlanSha256,openTarget:runtime.openTarget});
}
async function loadProductionRuntime(admitted){
 const [{runNativeProductionMigration},{PostgresDb},{parseS3Url},pg,publicationModule]=await Promise.all([import('./native-migration-production.ts'),import('../../services/app/lib/platform/db.ts'),import('../../services/app/lib/object-store/url.ts'),import('pg'),import(pathToFileURL(admitted.publication.path).href)]);
 if(typeof publicationModule.createNativePipelinePublication!=='function')fail('publication_factory');
 const publication=publicationModule.createNativePipelinePublication(admitted.publicationConfig);
 let decodeContext;
 if(admitted.codec){const module=await import(pathToFileURL(admitted.codec.path).href);decodeContext=module.decodeNativePipelineContext;if(typeof decodeContext!=='function')fail('context_codec');}
 return {run:options=>runNativeProductionMigration({...options,decodeContext}),openTarget:async plan=>{
  if(global.__artifact_bin_db__)fail('runtime_already_initialized');
  const s3=parseS3Url(admitted.env.S3_URL),connection=new URL(admitted.env.DATABASE_URL);connection.searchParams.set('options','-c search_path='+plan.target.appSchema);
  const pool=new pg.default.Pool({connectionString:connection.toString(),max:2});
  const db=new PostgresDb(pool);global.__artifact_bin_db__=Promise.resolve(db);
  return {db,s3,runtimeStorage:{bucket:s3.bucket,prefix:s3.prefix},origin:admitted.config.runtimeOrigin,publication,close:async()=>{global.__artifact_bin_db__=undefined;await db.close();}};
 }};
}
