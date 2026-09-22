import {withTokenAuth} from '@/lib/auth';
import {commentImageResponse} from '@/lib/comment-images';
/** Same attachment and artifact read checks as the browser, with bearer authentication. */
export const GET = withTokenAuth(async (request,{tokenId,userId,params}) =>
 commentImageResponse({tokenId,userId},params.id,params.imageId,new URL(request.url).searchParams.get('variant')??'preview'),
);
