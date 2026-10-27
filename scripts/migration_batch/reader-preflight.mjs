/** Validate the actual reader's expected pins at the correct lifecycle boundary.
 * Trusted local modules remain hash-bound inputs of the existing job manifest.
 */
import fs from'node:fs/promises';import path from'node:path';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';import{isDeepStrictEqual}from'node:util';
const hash=b=>createHash('sha256').update(b).digest('hex'),require=(ok,code)=>{if(!ok)throw Error(code)};
/** @param {import('./reader-preflight-contracts.js').ReaderPreflightOptions} options */
export async function preflightReader(options){
 const{configPath,id,phase}=options;require(['before-apply','after-apply-before-reader-db'].includes(phase),'reader_preflight_phase');
 const scope=await import(pathToFileURL(path.resolve(options.scopeModule)).href),digestModule=await import(pathToFileURL(path.resolve(options.digestModule)).href),digest=digestModule.preparedPilotStoreDigest;require(typeof digest==='function'&&typeof scope.readbackScope==='function','reader_scope_contract');
 const read=async p=>JSON.parse(await fs.readFile(p,'utf8')),config=await read(configPath);require(['receiptRoot','batchPath','planPath','outputDirectory'].every(k=>typeof config[k]==='string'&&config[k]),'reader_cli_config_shape');
 const{sha256:configSha,...configBody}=config;require(digest(configBody)===configSha,'reader_config_digest');const root=await fs.realpath(config.receiptRoot),bound=async ref=>{require(ref&&typeof ref.path==='string'&&!path.isAbsolute(ref.path),'reader_input_path');const p=await fs.realpath(path.resolve(root,ref.path));require(p.startsWith(root+path.sep),'reader_input_path');const bytes=await fs.readFile(p);require(hash(bytes)===ref.sha256,'reader_input_digest');return JSON.parse(bytes.toString())};
 const batch=await read(config.batchPath),{sha256:batchSha,...batchBody}=batch;require(digest(batchBody)===batchSha&&isDeepStrictEqual(batch.batchSourceIds,[id])&&batch.heads?.length===1&&batch.heads[0].sourceId===id,'reader_batch_scope');
 const selected=batch.heads[0],context=(await bound(selected.context)).context,comparison=await bound(selected.comparison),imported=await bound(selected.imported);require(context?.revision?.key?.sourceId===id&&Number.isInteger(context.revision.key.version)&&context.revision.key.version>0&&typeof context.assembly?.sha256==='string','reader_context_scope');
 const raw=await fs.readFile(comparison.comparisonPath),rawResult=JSON.parse(raw.toString());require(hash(raw)===comparison.comparisonSha256&&typeof rawResult.passed==='boolean'&&((comparison.status==='verified'&&rawResult.passed)||(comparison.status==='difference'&&!rawResult.passed)),'reader_comparison_binding');
 const expected={version:context.revision.key.version,assembly:context.assembly.sha256,comparison:comparison.comparisonSha256};
 for(const value of[comparison,imported])require(value.key?.sourceId===id&&value.key.version===expected.version&&value.assemblySha256===expected.assembly,'reader_context_binding');
 if(selected.reviewedDecision){const decision=await bound(selected.reviewedDecision);require(decision.accepted===true&&decision.strictPassed===false&&rawResult.passed===false&&decision.key?.sourceId===id&&decision.key.version===expected.version&&decision.assemblySha256===expected.assembly,'reader_decision_binding');expected.decision=selected.reviewedDecision.sha256;}
 require(isDeepStrictEqual(scope.approved?.[id],expected),'reader_expected_map_binding');
 // Before apply, target head/publication receipts do not exist. Never fabricate
 // them or call the complete readbackScope at that stage.
 let actual;
 if(phase==='after-apply-before-reader-db'){actual=await scope.readbackScope(configPath,id);require(isDeepStrictEqual(actual.expected,expected)&&typeof actual.headReceiptSha256==='string'&&typeof actual.publicationReceiptSha256==='string','reader_receipt_scope');}
 return{format:'migration-reader-binding-preflight-v1',phase,expected,receiptChecksPendingAfterApply:phase==='before-apply',actualReadbackScopeExecuted:!!actual,dbOpened:false,tokenMinted:false,productionWrites:0,...(actual?{headReceiptSha256:actual.headReceiptSha256,publicationReceiptSha256:actual.publicationReceiptSha256}:{})};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];const value=await preflightReader({configPath:args.config,id:args.id,scopeModule:args['scope-module'],digestModule:args['digest-module'],phase:args.phase});
 if(args.output){const bytes=JSON.stringify(value,null,2)+'\n';try{await fs.writeFile(args.output,bytes,{flag:'wx',mode:0o600})}catch(error){if(error.code!=='EEXIST'||await fs.readFile(args.output,'utf8')!==bytes)throw error;}}
 console.log(JSON.stringify(value));
}
