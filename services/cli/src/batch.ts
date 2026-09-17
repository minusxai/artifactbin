import {CliError} from './errors';
/** A batch preserves individual outcomes; one failure never hides completed targets. */
export async function batchCommand<T>(refs:string[],run:(ref:string)=>Promise<T>):Promise<{value:T|{results:unknown[]};exitCode:number}>{
 if(refs.length===1)return {value:await run(refs[0]),exitCode:0};
 const results:unknown[]=[];let exitCode=0;
 for(const ref of refs){
  try{results.push({ref,result:await run(ref)});}
  catch(error){exitCode=1;results.push({ref,error:error instanceof CliError?{code:error.code,message:error.message,...(error.fix?{fix:error.fix}:{}),...(error.details?{details:error.details}:{})}:{code:'operation_failed',message:error instanceof Error?error.message:String(error)}});}
 }
 return {value:{results},exitCode};
}
