import { withTokenAuth } from '@/lib/authentication';
import {commentImageResponse} from '@/lib/annotations';
/** Same attachment and artifact read checks as the browser, with bearer authentication. */
export const GET = withTokenAuth(async (request,{ actor,params }) =>
 commentImageResponse(actor,params.id,params.imageId,new URL(request.url).searchParams.get('variant')??'preview'),
);
