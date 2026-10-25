import path from 'node:path';
import {runTool,resolveTarget,selectedServer,makeClient,requireFlags,enumValue,integer,positional,exclusive,ToolError} from './toolbox-client.mjs';
export function imageDimensions(bytes,format){
 const data=Buffer.from(bytes);if(format==='png'&&data.length>=24&&data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {width:data.readUInt32BE(16),height:data.readUInt32BE(20)};
 if(format==='jpg'&&data[0]===255&&data[1]===216){let i=2;while(i+8<data.length){if(data[i++]!==255)continue;const marker=data[i++];if(marker===217||marker===218)break;const size=data.readUInt16BE(i);if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker))return {height:data.readUInt16BE(i+3),width:data.readUInt16BE(i+5)};if(size<2)break;i+=size;}}
 throw new ToolError('invalid_image','Export did not return a supported image payload.',1);
}
export async function exportCommand({values,positionals},options={}){
 requireFlags(values,['format','output']);const format=enumValue(values.format,['html','png','jpg'],'format');
 if(values.slide&&format==='html')throw new ToolError('unsupported_slide','--slide requires an image format.',2);
 const {server,id}=resolveTarget(positional(positionals),selectedServer(values,options.env)),client=makeClient(server,options);
 const query=new URLSearchParams({format});if(values.slide)query.set('slide',String(integer(values.slide,'slide')));
 const response=await client.request(`/a/${id}/${format==='html'?'download':'export'}?${query}`,{raw:true,timeoutMs:60000});
 const bytes=new Uint8Array(await response.arrayBuffer()),dimensions=format==='html'?{}:imageDimensions(bytes,format);
 if(format==='html'&&!response.headers.get('content-type')?.includes('text/html'))throw new ToolError('invalid_export','Expected portable HTML.',1);
 await exclusive(values.output,bytes);return {id,format,output:path.resolve(values.output),bytes:bytes.byteLength,...dimensions,outputOwned:true};
}
await runTool('export',import.meta.url,exportCommand);
