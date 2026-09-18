import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';

/**
 * DELETE /api/testusers/:id — the `testuser_delete` OPERATION.
 *
 * The erase is the whole product: everything the named person owns goes with
 * it, in one transaction, hard. Somebody else's id is `not_your_testuser`; one
 * that is already gone is 404, so a repeated delete reads as "done" rather than
 * as a refusal.
 */
export const DELETE = withTokenAuth(async (request, { tokenId, userId, params }) =>
  runOperation('testuser_delete', request, { tokenId, userId }, { id: params.id }));
