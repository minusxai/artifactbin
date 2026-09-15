import {exportAssetResponse} from '@/lib/export/assets';
export async function GET(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{
 return exportAssetResponse(request,(await context.params).id);
}
export const HEAD=GET;
