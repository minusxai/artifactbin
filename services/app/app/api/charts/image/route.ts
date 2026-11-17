import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
import { json, PayloadTooLarge, readJson } from '@/lib/http';
import { CHART_IMAGE_BODY_LIMIT } from '@artifactbin/contracts';

/**
 * POST /api/charts/image {chart, rows, width?, height?, theme?, designSystem?} — the
 * `render_chart_image` OPERATION: the caller's own rows drawn through a chart description, answered
 * as JSON with the PNG base64 in `data`. A body past CHART_IMAGE_BODY_LIMIT is `too_large`, the
 * operation's own code for an oversized drawing request.
 */
export const POST = withTokenAuth(async (request: Request, { actor }) => {
  let body: Record<string, unknown> | null;
  try { body = await readJson(request, { limit: CHART_IMAGE_BODY_LIMIT }); } catch (error) {
    if (error instanceof PayloadTooLarge) {
      return json({ error: 'too_large', message: `the request is past ${CHART_IMAGE_BODY_LIMIT} bytes`, hint: 'aggregate in SQL to fewer rows or columns' }, 413);
    }
    throw error;
  }
  if (!body) return json({ error: 'invalid_request', message: 'send a JSON object {chart, rows, width?, height?, theme?, designSystem?}' }, 400);
  return runOperation('render_chart_image', request, actor, body);
});
