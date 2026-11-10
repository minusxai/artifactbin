import {pageFunction} from '@/lib/page-doors';
type Context={params:Promise<Record<string,string>>};
/** A page function called by name (lib/page-doors `pageFunction`): GET reads with query parameters, POST with a JSON body. */
export async function GET(request:Request,context:Context){const {id,name}=await context.params;return pageFunction(request,id!,name!);}
export const POST=GET;
