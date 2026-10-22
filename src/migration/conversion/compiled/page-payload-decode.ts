import type{CompiledJavascriptPayload}from'./javascript-payload-contracts.ts';
import type{CompiledPagePayload,CompiledAsciiPayload}from'./page-payload-contracts.ts';
import type{decodeCompiledJavascript}from'./javascript-payload-decode.ts';
import type{decodeAscii91}from'./ascii91.ts';
/** Both streams retain the existing independent gzip, expanded-size and digest checks. */
export async function decodeCompiledPage(payload:CompiledPagePayload,signal:AbortSignal|undefined,decode:typeof decodeCompiledJavascript,dense:typeof decodeAscii91,document:Document):Promise<string>{
 const pending=document.querySelector('[data-af-compiled-style-pending]');
 try{
  if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).length!==2||!Object.hasOwn(payload,'stylesheet')||!Object.hasOwn(payload,'javascript'))throw Error('Invalid compiled page envelope');
  const unpack=async(part:CompiledAsciiPayload)=>{
   if(!part||typeof part!=='object'||Array.isArray(part)||Object.keys(part).length!==4||Object.keys(part).some(k=>!['compression','ascii91','sha256','uncompressedBytes'].includes(k))||part.compression!=='gzip'||typeof part.ascii91!=='string'||!part.ascii91.length||part.ascii91.length>4*1024*1024||typeof part.sha256!=='string'||!/^[a-f0-9]{64}$/.test(part.sha256)||!Number.isSafeInteger(part.uncompressedBytes)||part.uncompressedBytes<1||part.uncompressedBytes>32*1024*1024)throw Error('Invalid compiled page stream');
   if(signal?.aborted)throw Error('Compiled page cancelled');
   const bytes=dense(part.ascii91);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
   return decode({compression:part.compression,base64:btoa(binary),sha256:part.sha256,uncompressedBytes:part.uncompressedBytes} as CompiledJavascriptPayload,signal);
  };
  const css=payload.stylesheet===null?"":await unpack(payload.stylesheet),javascript=await unpack(payload.javascript);
  if(signal?.aborted)throw Error('Compiled page cancelled');
  const style=document.createElement('style');style.setAttribute('data-af-compiled-stylesheet','');style.textContent=css;document.head.append(style);
  let stopWaiting: (()=>void)|undefined;
  try{
   await Promise.race([document.fonts.ready,new Promise<never>((_resolve,reject)=>{
    const abort=()=>reject(Error("Compiled page cancelled"));
    stopWaiting=()=>signal?.removeEventListener("abort",abort);
    if(signal?.aborted)abort();else signal?.addEventListener("abort",abort,{once:true});
   })]);
  }finally{stopWaiting?.();}
  if(signal?.aborted)throw Error('Compiled page cancelled');
  return javascript;
 }finally{pending?.remove();}
}
