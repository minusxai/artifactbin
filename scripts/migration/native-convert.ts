/** Explicit parameterized conversion/import/capture driver; no implicit production host. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {runNativePipeline,nativePipelineFilePorts,writeNativePipelineResult,loadNativePipelineAdapter} from '../../src/migration/native-components/pipeline.ts';
import type {NativePipelineRequest} from '../../src/migration/native-components/pipeline-contracts.ts';
const [requestPath,adapterPath]=process.argv.slice(2);
if(!requestPath)throw Error('usage: native-convert.ts REQUEST_JSON [REVIEWED_ACTUAL_HOST_ADAPTER_MODULE]');
const request=JSON.parse(await readFile(requestPath,'utf8')) as NativePipelineRequest;
// Reserve output before invoking import/camera; existing outputs are never overwritten.
await mkdir(path.dirname(request.output),{recursive:true,mode:0o700});
const reservation=request.output;await mkdir(reservation,{mode:0o700});
try{
 const extra=adapterPath?await loadNativePipelineAdapter(adapterPath,request):{};
 const ports=await nativePipelineFilePorts(request,extra),result=await runNativePipeline(request,ports);
 await mkdir(path.dirname(request.output),{recursive:true,mode:0o700});await writeNativePipelineResult(request,result,true);
 console.log(JSON.stringify({sourceId:result.key.sourceId,version:result.key.version,status:result.status,blockers:result.blockers.map(b=>b.code)}));
 if(result.status==='blocked'||result.status==='difference')process.exitCode=1;
}catch(error){await writeFile(path.join(reservation,'failure.json'),JSON.stringify({stage:'failed',code:error instanceof Error?error.message:'native_pipeline_failed'}),{flag:'wx',mode:0o600});throw error;}
