import { withTokenAuth } from '@/lib/authentication';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';
export const GET = withTokenAuth(async (request, { actor, params }) =>
  runOperation(
    'get_dataset_policy',
    request,
    actor,
    { id: params.id },
  ),
);
export const PUT = withTokenAuth(
  async (request, { actor, params }) => {
    const body = await readJson(request);
    return body
      ? runOperation(
          'set_dataset_policy',
          request,
          actor,
          { ...body, id: params.id },
        )
      : json({ error: 'invalid_json' }, 400);
  },
);
