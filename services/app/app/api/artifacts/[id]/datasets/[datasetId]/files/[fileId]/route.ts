import { readFileRequest } from '@/lib/document-data';
export async function GET(request:Request,ctx:{params:Promise<{id:string;datasetId:string;fileId:string}>}) {
 const {id,datasetId,fileId}=await ctx.params;return readFileRequest(request,id,datasetId,fileId);
}
