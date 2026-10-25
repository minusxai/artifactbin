/** One disposable target lifecycle and immutable snapshot for an explicitly reviewed latest-head batch. */
import {readFile,writeFile} from 'node:fs/promises';import path from 'node:path';
import {runNativePipelineBatch} from '../../src/migration/native-components/pipeline-batch.ts';
import type {NativePipelineBatchRequest} from '../../src/migration/native-components/pipeline-batch-contracts.ts';
const file=process.argv[2];if(!file)throw Error('usage: native-convert-batch.ts BATCH_REQUEST_JSON');
const request=JSON.parse(await readFile(file,'utf8')) as NativePipelineBatchRequest;
try{const result=await runNativePipelineBatch(request);console.log(JSON.stringify({status:result.status,heads:result.heads.length,snapshots:1,storeContentSha256:result.snapshot.storeContentSha256}));}
catch(error){try{await writeFile(path.join(request.outputDirectory,'batch-failure.json'),JSON.stringify({status:'failed',code:error instanceof Error?error.message:'native_pipeline_batch_failed'}),{flag:'wx',mode:0o600});}catch{}throw error;}
