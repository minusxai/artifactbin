import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations';
import { json, PayloadTooLarge, readJson } from '@/lib/http';
import { SERVICE_PAYLOAD_LIMIT } from '@artifactbin/contracts/payload-limit';

/**
 * POST /api/charts/image {chart, rows, width?, height?, theme?, designSystem?} — the
 * `render_chart_image` OPERATION: the caller's own rows drawn through a chart description, answered
 * as JSON with the PNG base64 in `data`. A body past SERVICE_PAYLOAD_LIMIT is `too_large`, the
 * operation's own code for an oversized drawing request.
 */
export const POST = withTokenAuth(async (request: Request, { actor }) => {
  let body: Record<string, unknown> | null;
  try { body = await readJson(request, { limit: SERVICE_PAYLOAD_LIMIT }); } catch (error) {
    if (error instanceof PayloadTooLarge) {
      return json({ error: 'too_large', max: SERVICE_PAYLOAD_LIMIT, message: `the chart request is past the ${SERVICE_PAYLOAD_LIMIT}-byte limit`, hint: 'aggregate in SQL to fewer rows or columns' }, 413);
    }
    throw error;
  }
  if (!body) return json({ error: 'invalid_request', message: 'send a JSON object {chart, rows, width?, height?, theme?, designSystem?}' }, 400);
  return runOperation('render_chart_image', request, actor, body);
});
