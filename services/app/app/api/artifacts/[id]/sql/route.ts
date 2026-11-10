import {pageSqlDoor} from '@/lib/page-graphql';
/** A page's SQL door (lib/page-graphql `pageSqlDoor`): one statement over its dataset links as the reader. */
export async function POST(request:Request,context:{params:Promise<Record<string,string>>}){
 return pageSqlDoor(request,(await context.params).id!);
}
