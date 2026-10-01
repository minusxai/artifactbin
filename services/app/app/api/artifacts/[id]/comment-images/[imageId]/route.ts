import {withTokenAuth} from '@/lib/accounts';
import {commentImageResponse} from '@/lib/annotations';
/** Same attachment and artifact read checks as the browser, with bearer authentication. */
export const GET = withTokenAuth(async (request,{tokenId,userId,params}) =>
 commentImageResponse({tokenId,userId},params.id,params.imageId,new URL(request.url).searchParams.get('variant')??'preview'),
);
