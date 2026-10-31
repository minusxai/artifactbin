/** What this command does and how to use it; also printed by --help. */
export const DESCRIPTION = `Sign in, inspect or remove this origin's private grant.
It uses an email one-time code.
Usage: node scripts/auth.mjs status
       node scripts/auth.mjs login --email ADDRESS
       node scripts/auth.mjs login --challenge HANDLE --code-file FILE
       node scripts/auth.mjs logout [--local]
Flags: --email ADDRESS starts sign-in and prints a challenge HANDLE; --challenge HANDLE plus
  --code-file FILE (a file holding the code the user received by email; never pass codes on argv)
  completes it. Common: --server ORIGIN (default: the archive origin), --json, --output FILE
  (never overwrites), --help.
Examples:
  node scripts/auth.mjs status                        # reuse an existing grant before signing
                                                      #   in again
  node scripts/auth.mjs login --email me@example.com  # then wait for the user's emailed code
  node scripts/auth.mjs login --challenge HANDLE --code-file code.txt
Gotchas: use an email the user gave you; never invent an identity, and never search files,
  bundles, mailboxes or git config for credentials, codes or accounts: ask the user. status
  refreshes the saved grant, so authenticated:false means log in again. Challenges expire after 30
  minutes and are bound to the origin. Credentials live in the private origin store
  (ARTIFACTBIN_HOME or ~/.artifactbin); the file format and token refresh are in
  the selected origin's /llms/http-auth guide. logout ends the saved grant on the server, then
  removes it locally; unconfirmed revocation fails with serverRevoked:false and keeps the
  saved grant for retry. --local only removes the saved grant and leaves the server grant active.
  --revoke names the default and is kept for compatibility.
  An ARTIFACTBIN_URL + ARTIFACTBIN_TOKEN environment grant stays active.
  Every other script reuses this grant and refreshes an expired access token itself (the refresh
  token is single-use and serialized across processes, so never refresh by hand or copy the
  store). Network errors, 429 and server errors keep the grant: retry later. Missing credentials
  or invalid_grant, invalid_client or revoked_token mean log in again.
  The store is a private directory (0700) and file (0600) per origin; never log tokens or put them
  in URLs or pages.
Exit: 0 ok; 1 failed; 2 invocation; 3 auth/access; 4 conflict; 5 unknown write outcome.
  Results never contain credentials.`;

import path from 'node:path';
import {logoutGrant} from './auth-logout.mjs';
import {mkdir, readFile, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {
  runTool,
  ToolError,
  serverOrigin,
  selectedServer,
  credentialRoot,
  platform,
  jsonFile,
  exclusive,
  requireFlags,
  positional,
  makeClient
} from './toolbox-client.mjs';
// Subcommands: status (refreshes the saved grant to prove it works), logout (revokes, then
// removes the saved grant; --local only removes it), login (two steps: send the code, then
// exchange it).
export async function authCommand({sub, values, positionals}, {env = process.env, fetcher = fetch} =
  {}) {
  positional(positionals, 0);
  const server = serverOrigin(selectedServer(values, env)),
    root = credentialRoot(env),
    shared = await platform();
  // status: where the grant comes from (environment or the private store) and whether it has
  // expired.
  if (sub === 'status') {
    let saved = await shared.readCredentials(server, root),
      refresh = null;
    const stored = !!saved;
    const environment = !!(env.ARTIFACTBIN_URL === server && env.ARTIFACTBIN_TOKEN);
    // A saved grant is always refreshed, exactly as any other script would when its token is due,
    // so status proves the grant with the server: one revoked or ended elsewhere reads as signed
    // out, never as a still-unexpired local token. A refused refresh means log in again.
    if (!environment && saved) {
      try {
        saved = await shared.refreshCredentials(saved, root, {fetch: fetcher});
      } catch (error) {
        refresh = error.code === 'refresh_unavailable' ? 'unavailable' : 'refused';
        if (refresh === 'refused') saved = null;
      }
    }
    return {
      server,
      authenticated: environment || !!saved,
      ...(refresh ? {refresh} : {}),
      source: environment ? 'environment' : stored ? 'private-store' : 'none',
      expired: saved?.expiresAt ? Date.now() >= saved.expiresAt : null
    };
  }
  if (sub === 'logout')
    return {...await logoutGrant({values, server, root, shared, env, fetcher})};

  const client = makeClient(server, {env, fetcher});
  // login step 1: email a one-time code and save a private challenge file bound to this origin.
  if (values.email) {
    if (values.challenge || values['code-file'] || !/^\S+@\S+\.\S+$/.test(values.email))
      throw new ToolError('invalid_login', 'Use --email ADDRESS alone to initiate sign-in.', 2);
    await client.request('/api/auth/email-otp/send-verification-otp', {
      method: 'POST',
      body: {email: values.email, type: 'sign-in'},
      authenticated: false
    });
    const handle = randomUUID(),
      directory = path.join(root, 'challenges');
    await mkdir(directory, {recursive: true, mode: 0o700});
    await exclusive(
      path.join(directory, handle + '.json'),
      JSON.stringify({server, email: values.email, createdAt: Date.now()})
    );
    return {
      server,
      challenge: handle,
      next: 'Wait for the user-provided OTP, ' +
        'then auth.mjs login --challenge HANDLE --code-file FILE.'
    };
  }
  // login step 2: read the code from a file (never argv), exchange it for a session, then for a
  // bearer grant.
  requireFlags(values, ['challenge', 'code-file']);
  if (!/^[a-f0-9-]{36}$/.test(values.challenge))
    throw new ToolError('invalid_challenge', 'Use the private handle returned by login.', 2);
  const file = path.join(root, 'challenges', values.challenge + '.json'),
    challenge = await jsonFile(file);
  if (challenge.server !== server || Date.now() - challenge.createdAt > 30 * 60 * 1000)
    throw new ToolError(
      'challenge_expired',
      'Challenge origin or lifetime does not match.',
      3,
      'Start sign-in again.'
    );
  const code = (await readFile(values['code-file'], 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(code))
    throw new ToolError('invalid_code', 'OTP file must hold only the code the user provided.', 2);
  const response = await client.request('/api/auth/sign-in/email-otp', {
    method: 'POST',
    body: {email: challenge.email, otp: code},
    authenticated: false,
    raw: true
  });
  const cookies = response.headers
    .getSetCookie()
    .map(value => value.split(';')[0])
    .join('; ');
  if (!cookies) throw new ToolError('session_missing', 'Sign-in returned no session cookie.', 1);
  const tokenResponse = await client.request('/api/authentication/token', {
    method: 'POST',
    body: {},
    headers: {Cookie: cookies},
    authenticated: false
  });
  if (
    typeof tokenResponse.access_token !== 'string' ||
    typeof tokenResponse.refresh_token !== 'string' ||
    typeof tokenResponse.client_id !== 'string' ||
    !Number.isFinite(tokenResponse.expires_in)
  )
    throw new ToolError('invalid_grant_response', 'Sign-in grant was incomplete.', 1);
  await shared.saveCredentials(
    {
      server,
      token: tokenResponse.access_token,
      refreshToken: tokenResponse.refresh_token,
      clientId: tokenResponse.client_id,
      expiresAt: Date.now() + tokenResponse.expires_in * 1000
    },
    root
  );
  // The challenge is single-use.
  await unlink(file);
  return {server, authenticated: true};
}
await runTool('auth', import.meta.url, authCommand);
