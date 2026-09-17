/**
 * THE PROFILE FOLLOWS THE CLAIMS. The proxy owns identity (Better Auth's
 * `auth.user`); the app keeps its OWN row per person (`users`: id, email,
 * username, folders) fed from the signed actor's claims — the claims-
 * propagation pattern — so a person who signed up at the proxy exists to the
 * app the first time they arrive, and an email change reaches the app on the
 * next request. Written ON CHANGE only: a logged-in reader's hundred query
 * hops must not be a hundred writes.
 */
import type { Actor } from '@artifactbin/contracts';
import { describe, expect, it, vi } from 'vitest';
import { attachActor } from '@artifactbin/utils';
import { withTokenAuth } from '@/lib/auth';
import { profileWrites, syncProfile } from '@/lib/profiles';
import { mintToken } from '@/lib/tokens';
import { claimToken, createUser } from '@/lib/users';
import { sessionActor } from '@/lib/viewer';
import { POST as createArtifactRoute } from '@/app/api/artifacts/route';
import { POST as createSecretRoute } from '@/app/api/my/secrets/route';
import { request, useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();


const actorRequest = (actor: Actor) => request('/api/my/artifacts', { actor });

describe('profile sync from the actor', () => {
  it('creates the app\'s row for a session actor the app has never seen, with a handle assigned', async () => {
    const before = profileWrites();
    const actor = await sessionActor(actorRequest({ credential: 'session', userId: 'usr_new1', email: 'new@example.com', emailVerified: true }));
    expect(actor.viewer).toEqual({ userId: 'usr_new1', email: 'new@example.com', emailVerified: true });
    const db = await harness.db();
    const row = (await db.query<{ id: string; email: string; username: string | null }>('SELECT id, email, username FROM users WHERE id = $1', ['usr_new1'])).rows[0];
    expect(row).toMatchObject({ id: 'usr_new1', email: 'new@example.com' });
    expect(row.username).toMatch(/^new_[a-z0-9]{4}$/);
    expect(profileWrites() - before).toBe(1);
  });

  it('writes on CHANGE only: a second request with the same claims writes nothing; a new email is recorded', async () => {
    await sessionActor(actorRequest({ credential: 'session', userId: 'usr_same', email: 'a@example.com' }));
    const after1 = profileWrites();
    await sessionActor(actorRequest({ credential: 'session', userId: 'usr_same', email: 'a@example.com' }));
    await sessionActor(actorRequest({ credential: 'session', userId: 'usr_same', email: 'a@example.com' }));
    expect(profileWrites()).toBe(after1);
    await sessionActor(actorRequest({ credential: 'session', userId: 'usr_same', email: 'renamed@example.com' }));
    expect(profileWrites()).toBe(after1 + 1);
    const db = await harness.db();
    expect((await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', ['usr_same'])).rows[0].email).toBe('renamed@example.com');
  });

  it('never touches the table for a credential carrying no email claim', async () => {
    const before = profileWrites();
    await sessionActor(actorRequest({ credential: 'bearer', tokenId: 'tok_1', userId: 'usr_b' }));
    await sessionActor(actorRequest({ credential: 'agent-cookie', tokenId: 'tok_2' }));
    await sessionActor(actorRequest({ credential: 'none' }));
    expect(profileWrites()).toBe(before);
  });
});

/**
 * THE CLI-ONLY PERSON. A bearer caller's claims reach the app exactly as a
 * session's do — the proxy resolves the token's account and attaches its
 * address — and the row they feed is what `artifact_shares` is matched
 * through, so someone who only ever uses the CLI must not have to open a
 * browser once before the documents they were invited to appear.
 *
 * The bearer door is `withTokenAuth`, so that is where the sync sits; whether
 * the claims BELONG to the presented credential stays `tokenActorForRequest`'s
 * single rule (viewer-actor-of.test.ts pins its mismatch cases).
 */
describe('profile sync at the bearer door', () => {
  const cliRequest = (token: { id: string; token: string }, actor: Actor) =>
    attachActor(request('/api/artifacts', { token: token.token }), actor);
  const ok = withTokenAuth(async () => new Response('ok'));

  it('writes the row for a bearer token whose proxy claims name its account', async () => {
    const token = await mintToken('cli');
    await claimToken('usr_cli0000000001', token.token);
    const before = profileWrites();

    const response = await ok(cliRequest(token, { credential: 'bearer', tokenId: token.id, userId: 'usr_cli0000000001', email: 'CLI@Example.com', emailVerified: true }));
    expect(response.status).toBe(200);
    expect(profileWrites() - before).toBe(1);

    const db = await harness.db();
    const row = (await db.query<{ email: string; username: string | null }>('SELECT email, username FROM users WHERE id = $1', ['usr_cli0000000001'])).rows[0];
    expect(row.email).toBe('cli@example.com');
    expect(row.username).toMatch(/^cli_[a-z0-9]{4}$/);

    // ON CHANGE ONLY holds here too: the CLI's next hundred calls write nothing.
    await ok(cliRequest(token, { credential: 'bearer', tokenId: token.id, userId: 'usr_cli0000000001', email: 'cli@example.com', emailVerified: true }));
    expect(profileWrites() - before).toBe(1);
  });

  it('writes nothing for claims that do not belong to the presented token', async () => {
    const token = await mintToken('cli');
    await claimToken('usr_cli0000000002', token.token);
    const before = profileWrites();

    await ok(cliRequest(token, { credential: 'bearer', tokenId: 'tok_somethingelse', userId: 'usr_cli0000000002', email: 'other@example.com' }));
    await ok(cliRequest(token, { credential: 'bearer', tokenId: token.id, userId: 'usr_someoneelse00', email: 'other@example.com' }));
    expect(profileWrites()).toBe(before);
    expect((await (await harness.db()).query('SELECT 1 FROM users')).rows).toEqual([]);
  });

  /**
   * One address, two ids, is a provisioning fault (see below) — and a fault in
   * the identity store must not make the CLI unusable. The call answers as it
   * did before the row was attempted.
   */
  it('answers the request anyway when the address already belongs to another id, and SAYS SO once', async () => {
    const db = await harness.db();
    await db.query('INSERT INTO users (id, email, username) VALUES ($1, $2, $3)', ['usr_theotherone00', 'shared@example.com', 'shared_1234']);
    const token = await mintToken('cli');
    await claimToken('usr_cli0000000003', token.token);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const claims = { credential: 'bearer', tokenId: token.id, userId: 'usr_cli0000000003', email: 'shared@example.com', emailVerified: true } as const;
      const response = await ok(cliRequest(token, claims));
      expect(response.status).toBe(200);
      expect((await db.query<{ id: string }>('SELECT id FROM users WHERE email = $1', ['shared@example.com'])).rows.map((r) => r.id)).toEqual(['usr_theotherone00']);

      // SILENCE was the bug: an operator whose invitee never gains reach had nothing to read. The
      // warning carries lib/profiles' own diagnostic, naming the address and the id that holds it.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toMatch(/shared@example\.com.*usr_theotherone00/);

      // …and ONCE per person: the CLI's next hundred calls must not become a hundred log lines.
      await ok(cliRequest(token, claims));
      await ok(cliRequest(token, claims));
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  /**
   * A DRY RUN IS A QUESTION, NOT A VISIT. `withTokenAuth` already withholds `touchToken` from an
   * explicit `X-Artifactbin-Dry-Run` GET — the convention being that a caller asking "would this
   * work?" leaves no trace — so the profile upsert, which is the other write on that path, obeys it
   * too. An ordinary GET still writes: that is the whole point of syncing at the bearer door.
   */
  it('writes nothing for an explicit dry-run GET, and writes on the ordinary one', async () => {
    const token = await mintToken('cli');
    await claimToken('usr_cli0000000004', token.token);
    const claims = { credential: 'bearer', tokenId: token.id, userId: 'usr_cli0000000004', email: 'dry@example.com', emailVerified: true } as const;
    const before = profileWrites();

    const dry = await ok(attachActor(request('/api/artifacts', { token: token.token, headers: { 'X-Artifactbin-Dry-Run': '1' } }), claims));
    expect(dry.status).toBe(200);
    expect(profileWrites()).toBe(before);
    const db = await harness.db();
    expect((await db.query('SELECT 1 FROM users WHERE id = $1', ['usr_cli0000000004'])).rows).toEqual([]);

    expect((await ok(cliRequest(token, claims))).status).toBe(200);
    expect(profileWrites() - before).toBe(1);
  });
});

/**
 * THE SECOND BEARER DOOR. `withTokenAuth` is not the only place a token is admitted:
 * `requestOrSessionActor` (lib/viewer) resolves the same bearer for export, mutate, tables, raw, the
 * dataset endpoints and the remote routes. An invitee whose FIRST call lands on one of those was
 * still rowless there, and the SQL scopes that read a share through `(SELECT email FROM users WHERE
 * id = $p)` — every `editorScope` — answered the uniform 404. The claims-match rule is not repeated:
 * both doors call the one exported `syncProfileForToken`.
 */
describe('a bearer-only invitee whose first call is not a withTokenAuth route', () => {
  const TARGET = { host: 'db.example.com', port: 5432, database: 'commerce', username: 'reader', ssl: true };

  it('reaches a dataset shared with them as editor through /api/my/secrets, having never called another route', async () => {
    const owner = await createUser({ email: 'dataset-owner@example.com' });
    const ownerToken = await mintToken('owner');
    await claimToken(owner.id, ownerToken.token);
    const published = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: ownerToken.token, json: {
      dataset: { kind: 'stored', tables: [{ schema: 'public', name: 'rows', columns: [{ name: 'id', type: 'number' }], rows: [{ id: 1 }] }] },
      visibility: 'private',
    } }));
    expect(published.status, await published.clone().text()).toBe(201);
    const { id } = (await published.json()) as { id: string };

    const db = await harness.db();
    await db.query("INSERT INTO artifact_shares(artifact_id,email,role) VALUES($1,$2,'editor')", [id, 'firstcall@invited.example']);

    // The invitee: a token, an account and an invitation — and no `users` row, because nothing has
    // ever brought a cookie and this is their first request of any kind.
    const invitee = await mintToken('invitee');
    await claimToken('usr_cli0000000005', invitee.token);
    expect((await db.query('SELECT 1 FROM users WHERE id = $1', ['usr_cli0000000005'])).rows).toEqual([]);

    const response = await createSecretRoute(attachActor(
      request('/api/my/secrets', { method: 'POST', token: invitee.token, json: { value: 'a-password', connection: TARGET, datasetId: id } }),
      { credential: 'bearer', tokenId: invitee.id, userId: 'usr_cli0000000005', email: 'firstcall@invited.example', emailVerified: true },
    ));
    expect(response.status, await response.clone().text()).toBe(201);
    expect((await db.query<{ email: string }>('SELECT email FROM users WHERE id = $1', ['usr_cli0000000005'])).rows[0]?.email).toBe('firstcall@invited.example');
  });

  it('keeps the uniform 404 for an account nobody invited', async () => {
    const owner = await createUser({ email: 'dataset-owner2@example.com' });
    const ownerToken = await mintToken('owner2');
    await claimToken(owner.id, ownerToken.token);
    const published = await createArtifactRoute(request('/api/artifacts', { method: 'POST', token: ownerToken.token, json: {
      dataset: { kind: 'stored', tables: [{ schema: 'public', name: 'rows', columns: [{ name: 'id', type: 'number' }], rows: [{ id: 1 }] }] },
      visibility: 'private',
    } }));
    expect(published.status).toBe(201);
    const { id } = (await published.json()) as { id: string };

    const stranger = await mintToken('stranger');
    await claimToken('usr_cli0000000006', stranger.token);
    const response = await createSecretRoute(attachActor(
      request('/api/my/secrets', { method: 'POST', token: stranger.token, json: { value: 'a-password', connection: TARGET, datasetId: id } }),
      { credential: 'bearer', tokenId: stranger.id, userId: 'usr_cli0000000006', email: 'stranger@invited.example', emailVerified: true },
    ));
    expect(response.status).toBe(404);
  });
});

/**
 * THE PEOPLE WHO ALREADY EXIST — the deploy question, not a hypothetical.
 *
 * The app's rows and identity rows must agree on the stable user id: every
 * artifact, share and folder points at that id. If a separately provisioned
 * identity database presents a new id for an email the app already knows,
 * `users.email` is UNIQUE, so the app must diagnose the mismatch rather than
 * surfacing a raw constraint failure on every authenticated request.
 */
describe('a person the app already knew, arriving under a proxy-minted id', () => {
  /**
   * This should be prevented while provisioning the identity store. If it
   * happens anyway — for example, an app and proxy pointed at incompatible
   * databases — what came out was
   * `duplicate key value violates unique constraint "idx_users_email"` on
   * EVERY authenticated request, which says nothing about what is wrong or
   * what to do. It is the same outage either way; only one of them is
   * diagnosable.
   */
  it('refuses by NAME rather than dying on the index', async () => {
    const db = await harness.db();
    await db.query('INSERT INTO users (id, email, username) VALUES ($1, $2, $3)', ['usr_oldid000000000', 'returning@example.com', 'returning_1234']);

    await expect(syncProfile({ userId: 'usr_newid000000000', email: 'returning@example.com' }))
      .rejects.toThrow(/returning@example\.com.*(adopt|another id)/i);

    // And it changed nothing on the way out.
    const rows = (await db.query<{ id: string; username: string | null }>('SELECT id, username FROM users WHERE email = $1', ['returning@example.com'])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('usr_oldid000000000');
  });
});
