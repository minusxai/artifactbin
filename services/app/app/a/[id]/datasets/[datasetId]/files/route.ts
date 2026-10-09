import { uploadFileRequest } from '@/lib/artifacts/file-upload-http';
export async function POST(request:Request,ctx:{params:Promise<{id:string;datasetId:string}>}) {
 const {id,datasetId}=await ctx.params;return uploadFileRequest(request,id,datasetId);
}
