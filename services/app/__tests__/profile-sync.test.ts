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
import { describe, expect, it } from 'vitest';
import { profileWrites, syncProfile } from '@/lib/profiles';
import { sessionActor } from '@/lib/viewer';
import { request, useAppHarness } from '@/__tests__/harness';

const harness = useAppHarness();


const actorRequest = (actor: Actor) => request('/api/my/artifacts', { actor });

describe('profile sync from the actor', () => {
  it('creates the app\'s row for a session actor the app has never seen, with a handle assigned', async () => {
    const before = profileWrites();
    const actor = await sessionActor(actorRequest({ credential: 'session', userId: 'usr_new1', email: 'new@example.com', emailVerified: true }));
    expect(actor.viewer).toEqual({ userId: 'usr_new1', email: 'new@example.com' });
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

  it('never touches the table for a bearer, an agent cookie, or nobody', async () => {
    const before = profileWrites();
    await sessionActor(actorRequest({ credential: 'bearer', tokenId: 'tok_1', userId: 'usr_b' }));
    await sessionActor(actorRequest({ credential: 'agent-cookie', tokenId: 'tok_2' }));
    await sessionActor(actorRequest({ credential: 'none' }));
    expect(profileWrites()).toBe(before);
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
