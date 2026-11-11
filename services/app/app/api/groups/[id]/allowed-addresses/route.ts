/**
 * GET|POST|DELETE /api/groups/<id>/allowed-addresses — the addresses a group approves for its members on any page
 * (lib/trust/group-trust).
 *
 *   GET                                               → { addresses: [{ directive, host, approved_by, approved_at }] }
 *   POST   { connect?: [...], img?: [...], media?: [...] }  approve these exact https origins → { changed, addresses }
 *   DELETE { connect?: [...], img?: [...], media?: [...] }  remove them                       → { changed, addresses }
 *
 * Any direct member reads; a direct editor writes. Script, style and frame addresses (`directive_not_allowed`) and
 * wildcards (`wildcard_not_allowed`) are refused. With TRUST__GROUP_APPROVALS=off every call is
 * `group_approvals_disabled`. Auth is the group routes' (bearer or browser session); writes keep the trust doors'
 * origin rule and are JSON only (lib/trust write-guard).
 */
import { groupRoute } from '@/lib/group-routes';
import { json, readJson } from '@/lib/http';
import { listGroupAddresses, parseGroupAddresses, refusedTrustWrite, setGroupAddresses, TrustError } from '@/lib/trust';

const NO_STORE = { 'Cache-Control': 'no-store' };

const refusal = (error: unknown): Response => {
  if (error instanceof TrustError) return json({ error: error.code, ...(error.detail ? { detail: error.detail } : {}) }, error.status, NO_STORE);
  throw error;
};

export const GET = groupRoute(async (_request, userId, params) => {
  try { return json({ addresses: await listGroupAddresses(userId, String(params.id)) }, 200, NO_STORE); }
  catch (error) { return refusal(error); }
}, true);

const write = (present: boolean) => groupRoute(async (request, userId, params, actor) => {
  const refused = refusedTrustWrite(request);
  if (refused) return refused;
  const body = await readJson(request);
  try {
    const { changed } = await setGroupAddresses(userId, String(params.id), parseGroupAddresses(body), present, { tokenId: actor.tokenId ?? null });
    return json({ changed, addresses: await listGroupAddresses(userId, String(params.id)) }, 200, NO_STORE);
  } catch (error) { return refusal(error); }
});

export const POST = write(true);
export const DELETE = write(false);
