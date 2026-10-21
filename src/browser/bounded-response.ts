/** Enforce byte bounds while reading, before parsing or retaining an oversized response. */
export async function readBoundedJSON(response:Response,maxBytes:number):Promise<any>{
 const reader=response.body?.getReader();if(!reader)throw Error('Empty platform response');
 let bytes=0,raw='';const decoder=new TextDecoder();
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw Error('Platform response too large');raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();return JSON.parse(raw);}
 finally{await reader.cancel().catch(()=>{});}
}
