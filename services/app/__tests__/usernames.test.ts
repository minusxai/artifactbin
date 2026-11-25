/**
 * Usernames: auto-assigned at login (sanitized email local part + '_' + 4
 * random [a-z0-9], so the exact address is never confirmed and collisions
 * are a non-event), renameable, stored/matched lowercase, underscores only.
 * Old names are RELEASED on rename — every URL is anchored on the file id,
 * so nothing breaks and squatting a stale name buys nothing. The rules are
 * lib/accounts' (lib/accounts/__tests__/users.test.ts); this is the profile door.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { GET as getProfileRoute, PATCH as patchProfileRoute } from '@/app/api/my/profile/route';

import { getDb } from '@/lib/platform';
import { GET as readResource, PATCH as patchResource } from '@/app/api/account/profile/route';
import { ensureUsername } from '@/lib/accounts';
import { createUser } from '@/lib/accounts/testing';
import { bearerIdentity, mintAccountToken, useAppHarness, request, useSessionUser } from '@/__tests__/harness';

useAppHarness();
const sessionUser = useSessionUser('id');



beforeEach(async () => {
  sessionUser.id = '';
});

describe('GET/PATCH /api/my/profile', () => {
  it('refuses host handle changes at both profile doors while display names remain editable', async () => {
    const user = await ensureUsername(await createUser({email:'reader@example.test'}));
    const identity = await bearerIdentity();
    await identity.account({userId:user.id,email:user.email,emailVerified:true});
    const db = await getDb();
    await db.query(`INSERT INTO auth.account(id,"userId","providerId","accountId","createdAt","updatedAt")
      VALUES('bound',$1,'trusted:sample',$2,now(),now())`,[user.id,user.username]);
    sessionUser.id = user.id;
    const {token} = await mintAccountToken('profile',user.id);
    const current = await (await readResource(request('/api/account/profile',{token}))).json();
    const proposal = {username:'changed_handle',name:'Refused'};
    const personal = await patchProfileRoute(request('/api/my/profile',{method:'PATCH',json:proposal}));
    const resource = await patchResource(request('/api/account/profile',{method:'PATCH',token,json:{...current,...proposal}}));
    for (const response of [personal,resource]) {
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({error:'managed_username'});
    }
    expect((await patchProfileRoute(request('/api/my/profile',{method:'PATCH',json:{name:'Chosen Reader'}}))).status).toBe(200);
    for (const table of ['auth.users','auth."user"']) {
      expect((await db.query(`SELECT name FROM ${table} WHERE id=$1`,[user.id])).rows).toEqual([{name:'Chosen Reader'}]);
    }
  });
  it('401s without a session; reads and renames with one', async () => {
    expect((await getProfileRoute(request('/api/my/profile'))).status).toBe(401);

    const user = await ensureUsername(await createUser({ email: 'me@x.com' }));
    sessionUser.id = user.id;
    const profile = await (await getProfileRoute(request('/api/my/profile'))).json();
    expect(profile).toMatchObject({ email: 'me@x.com', username: user.username });

    const renamed = await patchProfileRoute(request('/api/my/profile', { method: 'PATCH', json: { username: 'brand_new', name: 'Sample Reader' } }));
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({ username: 'brand_new', name: 'Sample Reader' });

    const taken = await createUser({ email: 'other@x.com' });
    await ensureUsername(taken);
    sessionUser.id = taken.id;
    const foreign = await patchProfileRoute(request('/api/my/profile', {method:'PATCH', json:{id:user.id, name:'Other Reader'}}));
    expect(foreign.status).toBe(404);
    const conflict = await patchProfileRoute(request('/api/my/profile', { method: 'PATCH', json: { username: 'brand_new' } }));
    expect(conflict.status).toBe(409);
    const invalid = await patchProfileRoute(request('/api/my/profile', { method: 'PATCH', json: { username: 'no-hyphens' } }));
    expect(invalid.status).toBe(400);
  });
});
