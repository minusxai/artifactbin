import { withTokenAuth } from '@/lib/accounts';
import { CommentWaitCapacityError, InvalidCommentCursor, readCommentChangesFor } from '@/lib/annotations';
import { json } from '@/lib/http';
import { COMMENT_CHANGES_MAX_WAIT_SECONDS } from '@artifactbin/contracts';

/** Auth/query translation only; the annotations module owns replay and waits. */
export const GET = withTokenAuth(async (request, {tokenId, userId, params}) => {
  const query = new URL(request.url).searchParams;
  const after = query.get('after') ?? 'now';
  const waitRaw = query.get('wait') ?? '0';
  const limitRaw = query.get('limit') ?? '100';
  if (!/^\d+$/.test(waitRaw) || Number(waitRaw) > COMMENT_CHANGES_MAX_WAIT_SECONDS) return json({error: 'invalid_wait'}, 400);
  if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1 || Number(limitRaw) > 100) return json({error: 'invalid_limit'}, 400);
  try {
    const result = await readCommentChangesFor({tokenId, userId}, params.id, {
      after, waitSeconds: Number(waitRaw), limit: Number(limitRaw), signal: request.signal,
    });
    return result ? json(result, 200, {'Cache-Control': 'no-store'}) : json({error: 'not_found'}, 404);
  } catch (error) {
    if (request.signal.aborted) return json({error: 'aborted'}, 499);
    if (error instanceof CommentWaitCapacityError) return json({error: 'too_many_comment_waits'}, 429, {'Retry-After': '1'});
    if (error instanceof InvalidCommentCursor) return json({error: 'invalid_cursor'}, 400);
    throw error;
  }
}, {readOnly: true});
