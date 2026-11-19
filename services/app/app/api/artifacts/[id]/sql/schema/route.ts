/** Explicit current revision schema; pinned stored datasets and the reader's current policies only. */
import {pageRevisionSchemaDoor} from '@/lib/page-doors';
export async function GET(request:Request,context:{params:Promise<Record<string,string>>}){
 return pageRevisionSchemaDoor(request,(await context.params).id!);
}
