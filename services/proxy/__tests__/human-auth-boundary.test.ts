import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHumanAuth, type HumanAuth, type OutgoingMail } from '../src/auth/human';

const main = 'https://example.test', controls = 'https://i.example.test';
let pg: PGlite, auth: HumanAuth;
const sent: OutgoingMail[] = [];
beforeAll(async () => {
  pg = new PGlite();
  auth = await createHumanAuth({ pglite: pg, baseURL: main, controlsOrigin: controls,
    secure: true, secret: 'two-host-real-auth'.padEnd(32, '0'),
    mail: { send: async m => { sent.push(m); } } });
});
beforeEach(async () => {
  sent.length = 0;
  await pg.exec('DELETE FROM auth.session; DELETE FROM auth.account; DELETE FROM auth.verification; DELETE FROM auth.user');
});
afterAll(async () => { await pg.close(); });
const call = (path: string, body?: unknown, cookie = '', host = main) => auth.handler(new Request(`${host}/api/auth${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { origin: host, 'content-type': 'application/json', 'x-artifactbin-csrf': '1', cookie },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}));
async function login() {
  const email = 'boundary@example.test';
  expect((await call('/email-otp/send-verification-otp', { email, type: 'sign-in' })).status).toBe(200);
  const res = await call('/sign-in/email-otp', { email, otp: sent.at(-1)!.otp });
  expect(res.status).toBe(200);
  return res.headers.getSetCookie();
}
const pair = (cookie: string) => cookie.split(';')[0];
describe('real same-origin human authentication', () => {
  it('issues only a host-only full cookie after actual OTP login', async () => {
    const cookies=await login(),full=cookies.find(c=>c.startsWith('__Host-mx.session_token='));
    expect(full).toBeDefined();expect(cookies.some(c=>c.includes('mx-read='))).toBe(false);
    expect(full).not.toMatch(/;\s*Domain=/i);
    for(const flag of [/;\s*Secure/i,/;\s*HttpOnly/i,/;\s*Path=\//i,/;\s*SameSite=Lax/i])expect(full).toMatch(flag);
    const user=await auth.sessions.resolve(new Request(main,{headers:{cookie:pair(full!)}}));
    expect(user?.userId).toMatch(/^usr_/);
    expect(await auth.sessions.resolve(new Request(controls,{headers:{cookie:pair(full!)}}))).toBeNull();
  });
  it('rejects retired-host login and duplicate full cookies',async()=>{
    expect((await call('/email-otp/send-verification-otp',{email:'attack@example.test',type:'sign-in'},'',controls)).status).toBe(403);
    expect(sent).toHaveLength(0);
    const full=pair((await login()).find(c=>c.startsWith('__Host-mx.session_token='))!);
    expect(await auth.sessions.resolve(new Request(main,{headers:{cookie:full+'; '+full}}))).toBeNull();
  });
  it('revokes a retained full cookie on logout and rejects expired rows',async()=>{
    const full=pair((await login()).find(c=>c.startsWith('__Host-mx.session_token='))!);
    expect((await call('/sign-out',{},full)).status).toBe(200);
    expect(await auth.sessions.resolve(new Request(main,{headers:{cookie:full}}))).toBeNull();
    const fresh=pair((await login()).find(c=>c.startsWith('__Host-mx.session_token='))!);
    await pg.exec('UPDATE auth.session SET "expiresAt"=now()-interval \'1 hour\'');
    expect(await auth.sessions.resolve(new Request(main,{headers:{cookie:fresh}}))).toBeNull();
  });
  it('never upgrades legacy read handles or renamed legacy full cookies',async()=>{
    const full=pair((await login()).find(c=>c.startsWith('__Host-mx.session_token='))!);
    const original=await auth.sessions.resolve(new Request(main,{headers:{cookie:full}}));
    const value=full.slice(full.indexOf('=')+1);
    for(const name of ['__Secure-mx-read','mx-read','better-auth.session_token','__Secure-better-auth.session_token']){
      expect(await auth.sessions.resolve(new Request(main,{headers:{cookie:name+'='+value}}))).toBeNull();
    }
    const fresh=(await login()).map(pair).join('; ');
    expect((await auth.sessions.resolve(new Request(main,{headers:{cookie:fresh}})))?.userId).toBe(original!.userId);
  });
});
