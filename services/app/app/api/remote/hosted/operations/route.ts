import {hostedCommentOperation} from '@/lib/remote/hosted-comments';
export async function POST(request:Request){return hostedCommentOperation(request);}
