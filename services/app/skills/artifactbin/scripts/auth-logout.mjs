/** Internal saved-grant logout. Used by auth.mjs; keeps refresh and logout serialized. */
import {unlink} from 'node:fs/promises';
import {ToolError} from './toolbox-client.mjs';

export async function logoutGrant({values, server, root, shared, env, fetcher}) {
  if (values.local && values.revoke)
    throw new ToolError('invalid_logout', 'Choose --local or --revoke.', 2);
  const location = shared.credentialPaths(server, root);
  let serverRevoked = false;
  await shared.withStateLock(root, 'home', () =>
    shared.withStateLock(root, '@credential-refresh', async () => {
      // Select under the same locks as refresh/save. Never revoke an environment override.
      const saved = await shared.readCredentials(server, root);
      if (values.revoke) {
        if (!saved?.refreshToken || !saved?.clientId)
          throw new ToolError('revoke_unavailable', 'No saved refresh grant to revoke.', 3);
        let response;
        try {
          response = await fetcher(new URL('/oauth/revoke', server), {
            method: 'POST', headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({client_id: saved.clientId, token: saved.refreshToken}),
            redirect: 'error', signal: AbortSignal.timeout(30000)
          });
        } catch {
          throw new ToolError('revoke_unavailable',
            'Revocation unavailable; saved grant retained for retry.', 1);
        }
        if (!response.ok) throw new ToolError('revoke_unavailable',
          'Revocation refused; saved grant retained for retry.', 1);
        serverRevoked = true;
      }
      await unlink(location.backingPath).catch(error => {
        if (error.code !== 'ENOENT') throw error;
      });
    })
  );
  return {
    server, localGrantRemoved: true, serverRevoked,
    environmentGrantStillActive: !!(env.ARTIFACTBIN_URL === server && env.ARTIFACTBIN_TOKEN),
    ...(!serverRevoked ? {note: 'Local logout does not revoke the server grant.'} : {})
  };
}
