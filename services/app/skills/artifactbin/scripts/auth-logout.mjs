/**
 * Internal saved-grant logout. Used by auth.mjs; keeps refresh and logout serialized.
 * By default it revokes the saved grant's server family, then removes it locally; --local only
 * removes it locally. An unconfirmed revocation keeps the saved grant and fails.
 */
import {unlink} from 'node:fs/promises';
import {ToolError} from './toolbox-client.mjs';

// Refusals meaning the server grant is already ended.
const ALREADY_ENDED = new Set(['invalid_grant', 'revoked_token']);

function unrevoked(message, reason) {
  return new ToolError('revoke_unavailable',
    `${message}; the server grant may still be active and the saved grant was kept.`, 1,
    'Retry logout later, or run logout --local to remove only the saved grant.',
    {serverRevoked: false, localGrantRemoved: false, reason});
}

async function revokeSaved(saved, server, fetcher) {
  let response;
  try {
    response = await fetcher(new URL('/oauth/revoke', server), {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({client_id: saved.clientId, token: saved.refreshToken}),
      redirect: 'error', signal: AbortSignal.timeout(30000)
    });
  } catch {
    throw unrevoked('Revocation unavailable', 'network');
  }
  if (response.ok) return;
  const error = await response.json().then(body => body?.error, () => undefined);
  if (typeof error === 'string' && ALREADY_ENDED.has(error)) return;
  throw unrevoked('Revocation refused',
    typeof error === 'string' && /^[a-z_]{1,64}$/.test(error) ? error : `http_${response.status}`);
}

export async function logoutGrant({values, server, root, shared, env, fetcher}) {
  if (values.local && values.revoke)
    throw new ToolError('invalid_logout', 'Choose --local or --revoke.', 2);
  const revoke = !values.local;
  const location = shared.credentialPaths(server, root);
  let serverRevoked = false, saved = null;
  await shared.withStateLock(root, 'home', () =>
    shared.withStateLock(root, '@credential-refresh', async () => {
      // Select under the same locks as refresh/save. Never revoke an environment override.
      saved = await shared.readCredentials(server, root);
      if (revoke && saved) {
        if (!saved.refreshToken || !saved.clientId)
          throw new ToolError('revoke_unavailable',
            'The saved grant has no refresh credential to revoke; it was kept.', 3,
            'Run logout --local to remove only the saved grant.',
            {serverRevoked: false, localGrantRemoved: false, reason: 'no_refresh_grant'});
        await revokeSaved(saved, server, fetcher);
        serverRevoked = true;
      }
      await unlink(location.backingPath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    })
  );
  const note = !revoke ? 'Local logout does not revoke the server grant.'
    : !saved ? 'No saved grant for this origin; nothing to revoke.' : null;
  return {
    server, localGrantRemoved: true, serverRevoked,
    environmentGrantStillActive: !!(env.ARTIFACTBIN_URL === server && env.ARTIFACTBIN_TOKEN),
    ...(note ? {note} : {})
  };
}
