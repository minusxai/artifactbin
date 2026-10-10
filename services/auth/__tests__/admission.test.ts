import {describe,it,expect} from 'vitest';
import {createAuthHost} from '../src/parts';
import {admissionPolicyOf} from '../src/config';
import {testAuthOptions} from './helpers';
describe('deployment admission boundary',()=>{
 it('validates email globs and booleans without regex semantics',()=>{
  const p=admissionPolicyOf({AUTH__ALLOWED_EMAIL_PATTERNS:'*@example.com,owner@other.com',AUTH__INVITE_ONLY:'false'});
  expect(p.inviteOnly).toBe(false);expect(p.matches('A@Example.com')).toBe(true);expect(p.matches('a@exampleXcom')).toBe(false);
  for(const value of ['','[a-z]@example.com','*@example.com,'])expect(()=>admissionPolicyOf({AUTH__ALLOWED_EMAIL_PATTERNS:value})).toThrow();
  expect(()=>admissionPolicyOf({AUTH__INVITE_ONLY:'yes'})).toThrow();
 });
 it('rejects verified browser session before forwarding and prevents credential issuance',async()=>{
  const options=await testAuthOptions({sessions:{resolve:async()=>({userId:'usr_owner',email:'owner@example.com',emailVerified:true})},admitIdentity:async()=>false});
  const app=createAuthHost(options);
  expect((await app.request('/api/anything')).status).toBe(403);
  expect((await app.request('/api/authentication/token',{method:'POST'})).status).toBe(403);
 });
 it('checks newly completed login after response cookies before releasing them',async()=>{
  const options=await testAuthOptions({sessions:{resolve:async request=>request.headers.get('cookie')?.includes('signed=1')?{userId:'usr_owner',email:'owner@example.com',emailVerified:true}:null,handler:async()=>new Response('{}',{headers:{'set-cookie':'signed=1; HttpOnly'}})},admitIdentity:async()=>false});
  const response=await createAuthHost(options).request('/api/auth/sign-in/email-otp',{method:'POST'});
  expect(response.status).toBe(403);expect(response.headers.getSetCookie()).toEqual([]);
 });
});
