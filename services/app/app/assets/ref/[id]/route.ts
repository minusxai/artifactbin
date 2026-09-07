import {publicRefAsset} from '@/lib/public-ref-assets';
import {serveStoredFile} from '@/lib/story/file-store';
export async function GET(request: Request, ctx: {params:Promise<{id:string}>}):Promise<Response> {
  const {id}=await ctx.params;
  const row=await publicRefAsset(id);
  if(!row)return new Response('not found',{status:404,headers:{'Access-Control-Allow-Origin':'*','Cache-Control':'no-store'}});
  return serveStoredFile(request,row,true);
}
export const HEAD=GET;
