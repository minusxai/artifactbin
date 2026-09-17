import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';
export const GET = withTokenAuth(async (request, { tokenId, userId, params }) =>
  runOperation(
    'get_dataset_policy',
    request,
    { tokenId, userId },
    { id: params.id },
  ),
);
export const PUT = withTokenAuth(
  async (request, { tokenId, userId, params }) => {
    const body = await readJson(request);
    return body
      ? runOperation(
          'set_dataset_policy',
          request,
          { tokenId, userId },
          { ...body, id: params.id },
        )
      : json({ error: 'invalid_json' }, 400);
  },
);
