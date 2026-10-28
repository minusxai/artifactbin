/** Bulk-import converted latest heads into artefactbin with their original ids, owners, comments and datasets.
 * prepare: derive production authority for each prepared host context and seal plan, batch and CLI config (no target access).
 * run [--apply]: open the production target through the SSH tunnel and import the batch without camera evidence.
 * Usage: tsx scripts/native-migration-bulk-import.mts prepare|run CONFIG.json [--apply]
 */
import fs from 'node:fs/promises';import path from 'node:path';import net from 'node:net';import {spawn} from 'node:child_process';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';import {createRequire} from 'node:module';
import {preparedPilotStoreDigest as digest} from './lib/native-prepared-pilot-store.mjs';
const sha=(b:Uint8Array|string)=>createHash('sha256').update(b).digest('hex');
const readJson=async(p:string)=>JSON.parse(await fs.readFile(p,'utf8'));
const ref=async(p:string)=>({path:p,sha256:sha(await fs.readFile(p))});
const put=async(p:string,v:unknown)=>{await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});await fs.writeFile(p,JSON.stringify(v),{mode:0o600,flag:'wx'});return ref(p);};
interface BulkConfig{port?:number;tag:string;ids:string[];receiptRoot:string;basePlan:string;identity:string;hostHeads:string;codec:string;nativeDigestModule:string;publicationModule:string;publicationConfiguration:string;runtimeEnvironment:string;prepareImportModule:string;origin:string}
const [mode,configPath]=process.argv.slice(2),apply=process.argv.includes('--apply');
const cfg=await readJson(configPath) as BulkConfig,out=path.join(cfg.receiptRoot,'ready-queue','bulk-'+cfg.tag),rel=(p:string)=>path.relative(cfg.receiptRoot,p);

if(mode==='prepare'){
 const [{decodeNativePipelineContext},{nativeDigest},{materializeNativeProductionAuthority}]=await Promise.all([import(pathToFileURL(cfg.codec).href),import(pathToFileURL(cfg.nativeDigestModule).href),import('./lib/native-migration-production-authority.ts')]);
 const {sha256:_old,...base}=await readJson(cfg.basePlan),identity=await fs.readFile(cfg.identity);
 const plan={...base,identity:{path:rel(cfg.identity),sha256:sha(identity)},heads:base.heads.map((h:{key:{sourceId:string}})=>({...h})),batches:base.batches.map((b:{id:string;sourceIds:string[]})=>({...b,sourceIds:b.sourceIds.filter(id=>!cfg.ids.includes(id))})).filter((b:{sourceIds:string[]})=>b.sourceIds.length).concat([{id:'bulk-'+cfg.tag,sourceIds:cfg.ids}])};
 const wires=new Map<string,any>(),contexts=new Map<string,any>();
 for(const id of cfg.ids){
  const wire=await readJson(path.join(cfg.hostHeads,id,'host-context.json')),context=decodeNativePipelineContext(wire),recipe=await readJson(context.authorityRecipePath);
  const sourceHead=await fs.readFile(path.resolve(context.receiptRoot,recipe.inputs.sourceHead.path)),head=plan.heads.find((h:{key:{sourceId:string;version:number}})=>h.key.sourceId===id);
  // Same latest version; the canonical snapshot file may differ only in capture metadata.
  if(!head||JSON.stringify(head.key)!==JSON.stringify(context.revision.key))throw Error('bulk_plan_version:'+id+':'+head?.key.version+'!='+context.revision.key.version);
  head.canonicalSha256=sha(sourceHead);wires.set(id,wire);contexts.set(id,context);
 }
 const sealedPlan={...plan,sha256:digest(plan)},planRef=await put(path.join(out,'plan.json'),sealedPlan),heads=[];
 for(const id of cfg.ids){
  const {context}=await materializeNativeProductionAuthority({context:contexts.get(id),plan:sealedPlan,planReceiptRoot:cfg.receiptRoot,origin:cfg.origin,outputDirectory:path.join(out,id,'authority')});
  const wire=wires.get(id),{sha256:_w,...body}={...wire,context:{...wire.context,receiptRoot:context.receiptRoot,authorityRecipePath:context.authorityRecipePath}};
  const contextRef=await put(path.join(out,id,'context.json'),{...body,sha256:nativeDigest(body)});heads.push({sourceId:id,context:{path:rel(contextRef.path),sha256:contextRef.sha256}});
 }
 const batch={format:'native-production-batch-v1',id:'bulk-'+cfg.tag,planSha256:sealedPlan.sha256,batchSourceIds:cfg.ids,heads},batchRef=await put(path.join(out,'batch.json'),{...batch,sha256:digest(batch)});
 // The host publication differs from production only in target schemas and the catalog staging directory.
 const hostPublication=await readJson(cfg.publicationConfiguration);
 const publicationRef=await put(path.join(out,'publication.json'),{...hostPublication,shared:{...hostPublication.shared,schemas:{appSchema:sealedPlan.target.appSchema,authSchema:sealedPlan.target.authSchema},catalog:{...hostPublication.shared.catalog,sinkDirectory:path.join(out,'receipts','objects')}}});
 const cli={format:'native-production-cli-v1',runtimeOrigin:cfg.origin,runtimeEnvironment:await ref(cfg.runtimeEnvironment),planPath:planRef.path,batchPath:batchRef.path,receiptRoot:cfg.receiptRoot,outputDirectory:path.join(out,'receipts'),
  publication:{module:await ref(cfg.publicationModule),configuration:publicationRef},contextCodec:await ref(cfg.codec)};
 const cliRef=await put(path.join(out,'cli.json'),{...cli,sha256:digest(cli)});
 console.log(JSON.stringify({prepared:cfg.ids.length,out,planSha256:sealedPlan.sha256,configSha256:digest(cli),cli:cliRef.path}));
}else if(mode==='run'){
 const cliPath=path.join(out,'cli.json'),cli=await readJson(cliPath),plan=await readJson(cli.planPath);
 process.env.ARTIFACTS__ALLOW_PUBLIC='1';let ssh:ReturnType<typeof spawn>|undefined;
 const {runNativeProductionCli}=await import('./lib/native-migration-production-cli.mjs');
 try{
  const result=await runNativeProductionCli({configPath:cliPath,apply,approvedPlanSha256:plan.sha256,approvedConfigSha256:cli.sha256},async(admitted:any)=>{
   const root=path.resolve(import.meta.dirname,'..');
   const [{runNativeProductionMigration},{PostgresDb},{parseS3Url},pg,publicationModule,codec,{prepareNativeProductImport}]=await Promise.all([import('./lib/native-migration-production.ts'),import(root+'/services/app/lib/platform/db.ts'),import(root+'/services/app/lib/object-store/url.ts'),import(root+'/node_modules/pg/lib/index.js'),import(pathToFileURL(admitted.publication.path).href),import(pathToFileURL(admitted.codec.path).href),import(pathToFileURL(cfg.prepareImportModule).href)]);
   const publication=publicationModule.createNativePipelinePublication(admitted.publicationConfig);
   return{run:(options:any)=>runNativeProductionMigration({...options,admitWithoutComparison:true,decodeContext:codec.decodeNativePipelineContext,prepareImport:(raw:any,ports:any)=>prepareNativeProductImport(raw,ports)}),
    // Same tunnel and TLS binding as the reviewed single-head launcher.
    openTarget:async(p:any)=>{if((globalThis as any).__artifact_bin_db__)throw Error('native_production_runtime_already_initialized');const connection=new URL(admitted.env.DATABASE_URL),originalHost=connection.hostname,originalPort=Number(connection.port||5432),port=cfg.port??53341;if(connection.searchParams.get('sslmode')!=='verify-full'||!connection.searchParams.get('sslrootcert'))throw Error('native_production_tls_binding');
     ssh=spawn('ssh',['-o','ConnectTimeout=10','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=8','-o','TCPKeepAlive=yes','-i',process.env.HOME+'/.ssh/aws_login','-N','-L',`127.0.0.1:${port}:${originalHost}:${originalPort}`,'ubuntu@artifactbin.dev'],{stdio:['ignore','ignore','pipe']});let exited=false;ssh.once('exit',()=>{exited=true;});
     await new Promise<void>((resolve,reject)=>{let n=0;const check=()=>{if(exited)return reject(Error('native_production_tunnel_failed'));const s=net.connect(port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve();});s.once('error',()=>{s.destroy();if(++n>=100)reject(Error('native_production_tunnel_timeout'));else setTimeout(check,100);});};check();});
     class TunnelSocket extends net.Socket{connect(q:any,h:any,...rest:any[]):any{if(Number(q)!==originalPort||h!==originalHost)throw Error('native_production_transport_binding');return super.connect(port,'127.0.0.1',...rest as []);}}
     connection.searchParams.set('options','-c search_path='+p.target.appSchema);// Long publications leave pooled connections idle; close them early and never let an idle drop crash the run.
     const stats={queries:0,s3:0,ms:0,started:Date.now(),by:{} as Record<string,{n:number;ms:number}>},rawQuery=pg.default.Client.prototype.query;(globalThis as any).__bulk_stats__=stats;
     pg.default.Client.prototype.query=function(this:any,...a:any[]){const t=Date.now(),r=rawQuery.apply(this,a);stats.queries++;const sql=String(typeof a[0]==='string'?a[0]:a[0]?.text??'').replace(/\s+/g,' ').trim().slice(0,90),row=(stats as any).by[sql]??=({n:0,ms:0});row.n++;if(r&&typeof r.then==='function')return r.finally(()=>{const d=Date.now()-t;stats.ms+=d;row.ms+=d;});return r;};
     for(const base of [root,path.dirname(cfg.prepareImportModule)]){try{const {S3Client}=createRequire(base+'/x.js')('@aws-sdk/client-s3'),send=S3Client.prototype.send;if(!send.__counted){S3Client.prototype.send=function(this:any,command:any,...rest:any[]){const t=Date.now(),name='S3 '+command.constructor.name,row=(stats as any).by[name]??=({n:0,ms:0});row.n++;(stats as any).s3++;return send.call(this,command,...rest).finally(()=>{row.ms+=Date.now()-t;});};S3Client.prototype.send.__counted=true;}}catch{}}
     const pool=new pg.default.Pool({connectionString:connection.toString(),max:2,connectionTimeoutMillis:10000,idleTimeoutMillis:30000,keepAlive:true,keepAliveInitialDelayMillis:10000,stream:()=>new TunnelSocket()});pool.on('error',(e:Error)=>console.error('idle pool connection dropped:',e.message));const db=new PostgresDb(pool);(globalThis as any).__artifact_bin_db__=Promise.resolve(db);const s3=parseS3Url(admitted.env.S3_URL);
     return{db,s3,runtimeStorage:{bucket:s3.bucket,prefix:s3.prefix},origin:admitted.config.runtimeOrigin,publication,close:async()=>{const st=(globalThis as any).__bulk_stats__;console.error('db stats',JSON.stringify({queries:st.queries,s3Calls:st.s3,dbWaitSeconds:Math.round(st.ms/1000),wallSeconds:Math.round((Date.now()-st.started)/1000)}));await fs.writeFile(path.join(out,'db-profile-'+Date.now()+'.json'),JSON.stringify(Object.entries(st.by).sort((x:any,y:any)=>y[1].ms-x[1].ms).map(([sql,v]:any)=>({...v,sql})),null,1));(globalThis as any).__artifact_bin_db__=undefined;await db.close();ssh?.kill('SIGTERM');}};}};
  });
  await fs.writeFile(path.join(out,(apply?'apply':'dry-run')+'-result-'+Date.now()+'.json'),JSON.stringify(result),{mode:0o600,flag:'wx'});console.log(JSON.stringify(result));
 }catch(e){const error=e as any;await fs.writeFile(path.join(out,'failure-'+Date.now()+'.json'),JSON.stringify({message:error.message,stack:error.stack,cause:error.cause?.message}),{mode:0o600,flag:'wx'});console.error(error.message);process.exitCode=1;}
 finally{ssh?.kill('SIGTERM');}
}else{console.error('usage: native-migration-bulk-import.mts prepare|run CONFIG.json [--apply]');process.exitCode=64;}
