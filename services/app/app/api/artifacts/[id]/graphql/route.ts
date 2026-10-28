import {pageGraphql} from '@/lib/page-graphql';
type Context={params:Promise<Record<string,string>>};
export async function GET(request:Request,context:Context){return pageGraphql(request,(await context.params).id!);}
export async function POST(request:Request,context:Context){return pageGraphql(request,(await context.params).id!);}
