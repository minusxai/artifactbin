/**
 * Internal sign-in status and two-step sign-in. Used by auth.mjs. Status refreshes the saved grant
 * to prove it works and says who it acts as. Sign-in: step 1 emails a
 * one-time code and saves a private challenge bound to the origin; step 2 reads the code from a
 * file, signs in and saves each grant whole: the user's, a service's beside it, or a group's in its
 * own file (--as-group), never over the user's.
 */
import path from 'node:path';
import {mkdir, readFile, unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {ToolError, envServer, jsonFile, exclusive, requireFlags, makeClient}
  from './toolbox-client.mjs';

export async function loginGrant({values, server, root, shared, env, fetcher, audience, group,
  level, actsAs}) {
  const client = makeClient(server, {env, fetcher});
  const post = (route, body, cookie) => client.request(route, {method: 'POST', body,
    authenticated: false, ...cookie === undefined ? {raw: true} : {headers: {Cookie: cookie}}});
  // login step 1: email a one-time code and save a private challenge file bound to this origin.
  if (values.email) {
    if (values.challenge || values['code-file'] || !/^\S+@\S+\.\S+$/.test(values.email))
      throw new ToolError('invalid_login', 'Use --email ADDRESS alone to initiate sign-in.', 2);
    await post('/api/auth/email-otp/send-verification-otp', {email: values.email, type: 'sign-in'});
    const handle = randomUUID(), directory = path.join(root, 'challenges');
    await mkdir(directory, {recursive: true, mode: 0o700});
    await exclusive(path.join(directory, handle + '.json'),
      JSON.stringify({server, email: values.email, createdAt: Date.now()}));
    return {server, challenge: handle,
      next: 'Wait for the user-provided OTP, then auth.mjs login --challenge HANDLE --code-file ' +
        'FILE.'};
  }
  // login step 2: read the code from a file (never argv), exchange it for a session, then for a
  // bearer grant.
  requireFlags(values, ['challenge', 'code-file']);
  if (!/^[a-f0-9-]{36}$/.test(values.challenge))
    throw new ToolError('invalid_challenge', 'Use the private handle returned by login.', 2);
  const file = path.join(root, 'challenges', values.challenge + '.json'),
    challenge = await jsonFile(file);
  if (challenge.server !== server || Date.now() - challenge.createdAt > 30 * 60 * 1000)
    throw new ToolError('challenge_expired', 'Challenge origin or lifetime does not match.', 3,
      'Start sign-in again.');
  const code = (await readFile(values['code-file'], 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(code))
    throw new ToolError('invalid_code', 'OTP file must hold only the code the user provided.', 2);
  const response = await post('/api/auth/sign-in/email-otp', {email: challenge.email, otp: code});
  const cookies = response.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  if (!cookies) throw new ToolError('session_missing', 'Sign-in returned no session cookie.', 1);
  const grant = await post('/api/authentication/token',
    group ? {group_id: group, group_role: level} : {}, cookies);
  // The service grant, from the same sign-in: its own token, bound to that service's origin.
  const service = audience ? await post('/api/authentication/token', {audience}, cookies) : null;
  // Each grant saved whole: a group's in its own file, never over the user's.
  for (const [saved, extra] of [[grant, group ? {group, groupRole: level} : {}],
    ...service ? [[service, {audience, resource: service.resource}]] : []]) {
    if (typeof saved.access_token !== 'string' || typeof saved.refresh_token !== 'string' ||
      typeof saved.client_id !== 'string' || !Number.isFinite(saved.expires_in) ||
      extra.audience && typeof saved.resource !== 'string')
      throw new ToolError('invalid_grant_response', 'Sign-in grant was incomplete.', 1);
    await shared.saveCredentials({server, ...extra, token: saved.access_token,
      refreshToken: saved.refresh_token, clientId: saved.client_id,
      expiresAt: Date.now() + saved.expires_in * 1000}, root);
  }
  // The challenge is single-use.
  await unlink(file);
  return {server, authenticated: true, actsAs: actsAs(), ...(audience ? {audience} : {})};
}

// status: where the grant comes from (environment or the private store) and whether it has
// expired.
export async function statusGrant({server, root, shared, env, fetcher, audience, group, actsAs}) {
  let saved = await shared.readCredentials(server, root, audience, group), refresh = null;
  const stored = !!saved;
  const environment = !audience && !group &&
    !!(envServer(env) === server && env.ARTIFACTBIN_TOKEN);
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
  return {server, ...(audience ? {audience} : {}), authenticated: environment || !!saved,
    actsAs: actsAs(saved), ...(refresh ? {refresh} : {}),
    source: environment ? 'environment' : stored ? 'private-store' : 'none',
    expired: saved?.expiresAt ? Date.now() >= saved.expiresAt : null};
}
