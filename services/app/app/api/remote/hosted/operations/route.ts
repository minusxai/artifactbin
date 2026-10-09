import {hostedCommentOperation} from '@/lib/runner/hosted-comments';
export async function POST(request:Request){return hostedCommentOperation(request);}
