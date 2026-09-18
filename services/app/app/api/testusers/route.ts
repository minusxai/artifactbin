import { withTokenAuth } from '@/lib/auth';
import { runOperation } from '@/lib/operations/http';

/**
 * GET|POST /api/testusers — the `testuser_list` and `testuser_create`
 * OPERATIONS: the throwaway second people this account holds, and one more.
 *
 * A translation layer and nothing else, like every other operation door: the
 * cap, the parent and the erase all live in `lib/testusers`, and who may mint
 * at all is `lib/capabilities`' single answer (an account; never a guest and
 * never a test user minting a third person).
 *
 * The POST takes no body. A test user has nothing to configure — a label it
 * chooses itself is what makes two of them tellable apart, and a lifetime the
 * caller could set is a lifetime somebody sets to a year.
 */
export const POST = withTokenAuth(async (request, { tokenId, userId }) =>
  runOperation('testuser_create', request, { tokenId, userId }, {}));

export const GET = withTokenAuth(async (request, { tokenId, userId }) =>
  runOperation('testuser_list', request, { tokenId, userId }, {}), { readOnly: true });
