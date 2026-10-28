import {localConnectionGraphql} from '@/lib/local-connection';
export async function POST(request:Request,context:{params:Promise<{id:string}>}){return localConnectionGraphql(request,(await context.params).id);}
