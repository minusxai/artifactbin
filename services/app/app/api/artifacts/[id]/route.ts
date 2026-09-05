import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';
import { json, readJson } from '@/lib/http';

/** GET /api/artifacts/:id — full read-back (source markup + meta). Actor-scope; else uniform 404. */
export const GET = withTokenAuth((request: Request, { tokenId, userId, params }) =>
  runOperation('get_artifact', request, { tokenId, userId }, { id: params.id }));

/**
 * PUT /api/artifacts/:id — full replace with `markup` or a data tier (may switch
 * formats): archives the current state and bumps version. URL never changes.
 */
export const PUT = withTokenAuth(async (request: Request, { tokenId, userId, params }) => {
  const body = await readJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  // The path names the document; a body `id` never overrides it.
  return runOperation('update_artifact', request, { tokenId, userId }, { ...body, id: params.id });
});

/**
 * DELETE /api/artifacts/:id — TRASHES the artifact, and a FOLDER with its whole
 * subtree (lib/trash, one statement): the link stops working at once, nothing is
 * erased, and `restore_artifact` takes it back at any time — there is no
 * retention and no sweep, so the row and its history are kept for good.
 * `?force=true` breaks dependents' refs knowingly.
 */
export const DELETE = withTokenAuth((request: Request, { tokenId, userId, params }) =>
  runOperation('delete_artifact', request, { tokenId, userId }, {
    id: params.id,
    force: new URL(request.url).searchParams.get('force') === 'true',
  }));
