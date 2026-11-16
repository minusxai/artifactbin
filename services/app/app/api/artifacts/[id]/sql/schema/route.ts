/** Explicit current revision evidence schema; pinned stored datasets and current human policies only. */
import {pageEvidenceSchemaDoor} from '@/lib/page-doors';
export async function GET(request:Request,context:{params:Promise<Record<string,string>>}){
 return pageEvidenceSchemaDoor(request,(await context.params).id!);
}
