import {json} from '@/lib/http';
import {DatasetError} from './errors';
export async function datasetResponse(work:()=>Promise<unknown>,status=200,headers:Record<string,string>={}):Promise<Response>{
 try{return json(await work(),status,headers);}catch(error){return json({error:'dataset_error',details:[error instanceof Error?error.message:'Dataset request failed']},error instanceof DatasetError?error.status:400,headers);}
}
