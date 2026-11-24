/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Sign in, inspect or remove this origin's private grant.
It uses an email one-time code.
Usage: node scripts/auth.mjs status [--audience SERVICE|--as-group ID]
       node scripts/auth.mjs login --email ADDRESS
       node scripts/auth.mjs login --challenge HANDLE --code-file FILE [--audience SERVICE]
         [--as-group ID --level member|editor]
       node scripts/auth.mjs logout [--local] [--audience SERVICE|--as-group ID]
Flags: --email ADDRESS starts sign-in and prints a challenge HANDLE; --challenge HANDLE plus
  --code-file FILE (a file holding the code the user received by email; never pass codes on argv)
  completes it. The one grant reaches a service this server issues tokens for: scripts exchange
  it for short-lived tokens (toolbox-service-token.mjs). --audience SERVICE there also saves a
  separate long grant for that service, rarely needed; status and logout take it.
  --as-group ID --level L signs this agent in AS that group at that level (not as the user, who
  must hold it there), saved beside the user's grant; ARTIFACTBIN_AS_GROUP=ID makes scripts use it
  over any environment grant.
  Common: --server ORIGIN (default: the archive origin), --json, --output FILE (never
  overwrites), --help.
Examples:
  node scripts/auth.mjs status                        # reuse an existing grant before signing
                                                      #   in again
  node scripts/auth.mjs login --email me@example.com  # then wait for the user's emailed code
  node scripts/auth.mjs login --challenge HANDLE --code-file code.txt
Gotchas: status refreshes the saved grant, so authenticated:false means log in again.
  Challenges expire after 30 minutes and are bound to the origin. Credentials live in the
  private origin store (ARTIFACTBIN_HOME or ~/.artifactbin); every other script reuses and
  refreshes them itself, so never refresh by hand or copy the store. logout ends the saved grant
  on the server, then removes it locally; unconfirmed revocation fails with serverRevoked:false
  and keeps the saved grant for retry. --local only removes the saved grant and leaves the server
  grant active. An ARTIFACTBIN_URL + ARTIFACTBIN_TOKEN environment grant stays active.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Results never contain credentials.`;

import {logoutGrant} from './toolbox-auth-logout.mjs';
import {loginGrant, statusGrant} from './toolbox-auth-grants.mjs';
import {runTool, ToolError, serverOrigin, selectedServer, credentialRoot, platform, positional}
  from './toolbox-client.mjs';
// Subcommands: status (refreshes the saved grant to prove it works), logout (revokes, then
// removes the saved grant; --local only removes it), login (two steps: send the code, then
// exchange it).
/** @returns {Promise<any>} */
export async function authCommand({sub, values, positionals}, {env = process.env, fetcher = fetch} =
  {}) {
  positional(positionals, 0);
  const server = serverOrigin(selectedServer(values, env)), root = credentialRoot(env),
    shared = await platform();
  const audience = values.audience, level = values.level, group = values['as-group'] ??
    (sub === 'login' ? undefined : env.ARTIFACTBIN_AS_GROUP || undefined);
  if (audience !== undefined && !/^[a-z][a-z0-9-]{0,62}$/.test(audience))
    throw new ToolError('invalid_audience', 'Use the service id the server is configured for.', 2);
  if (group && (!/^[\w-]{1,64}$/.test(group) || audience) || (group || level) && sub === 'login' &&
    !values.email && !(group && /^(member|editor)$/.test(level)))
    throw new ToolError('invalid_group', 'Use --as-group ID with --level member|editor.', 2);
  // Who a sign-in acts as: a group at its level, or the user.
  const actsAs = saved => group ? {group, level: saved?.groupRole ?? level} : 'user';
  if (sub === 'status')
    return statusGrant({server, root, shared, env, fetcher, audience, group, actsAs});
  if (sub === 'logout')
    return {...await logoutGrant({values, server, root, shared, env, fetcher, audience, group})};

  return loginGrant({values, server, root, shared, env, fetcher, audience, group, level, actsAs});
}
await runTool('auth', import.meta.url, authCommand);
