import {expect,it,vi} from 'vitest';
import {createBaselineSession,validateBaselineAccount} from '../lib/component-baseline-session.mjs';

it('rejects nonlocal servers and nondisposable identities before login',async()=>{
 const signIn=vi.fn();
 await expect(createBaselineSession({base:'https://example.com',account:{email:'mxmx_test_case@example.com'},signIn})).rejects.toThrow('local');
 await expect(createBaselineSession({base:'http://localhost:3030',account:{email:'person@example.com'},signIn})).rejects.toThrow('disposable');
 expect(signIn).not.toHaveBeenCalled();
 expect(()=>validateBaselineAccount({email:'mxmx_test_case@example.com',cookie:'secret'})).toThrow('credential');
});
it('relogs the referenced real account and mounts cookie credentials only on its local origin',async()=>{
 const signIn=vi.fn(async()=>({cookie:'session=real-session; other=value'}));
 const account={email:'mxmx_test_case@example.com'};
 const session=await createBaselineSession({base:'http://localhost:3030/path',account,signIn});
 const addCookies=vi.fn(async()=>{});
 await session.mount({context:()=>({addCookies}),request:{get:async()=>({ok:()=>true,json:async()=>({user:{id:'usr_real',email:account.email}})})}});
 expect(signIn).toHaveBeenCalledWith('http://localhost:3030',{email:account.email});
 expect(addCookies).toHaveBeenCalledWith([{name:'session',value:'real-session',url:'http://localhost:3030'},{name:'other',value:'value',url:'http://localhost:3030'}]);
 expect(JSON.stringify(account)).not.toContain('session');
});
it('refuses an empty login session instead of silently capturing anonymously',async()=>{
 await expect(createBaselineSession({base:'http://localhost:3030',account:{email:'mxmx_test_case@example.com'},signIn:async()=>({cookie:''})})).rejects.toThrow('session');
});

it('refuses a browser session belonging to a different account',async()=>{
 const session=await createBaselineSession({base:'http://localhost:3030',account:{email:'mxmx_test_case@example.com'},signIn:async()=>({cookie:'session=actual'})});
 await expect(session.mount({context:()=>({addCookies:async()=>{}}),request:{get:async()=>({ok:()=>true,json:async()=>({user:{id:'usr_other',email:'mxmx_test_other@example.com'}})})}})).rejects.toThrow('identity was not confirmed');
});

it('seeds a profile image through the session-only HTTP API and reads actual account data back',async()=>{
 const {seedBaselineIdentity}=await import('../lib/component-baseline-session.mjs');
 const calls=[];
 const send=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify(url.endsWith('/get-session')?{user:{id:'usr_actual',email:'mxmx_test_identity@example.com'}}:url.endsWith('/profile')&&options.method==='GET'?{name:'Test identity',username:'mxmx_test_identity',image:'http://localhost:3030/api/users/usr_actual/avatar'}:{}),{status:200});};
 const bytes=new Uint8Array([1,2,3]);
 const identity=await seedBaselineIdentity({base:'http://localhost:3030',account:{email:'mxmx_test_identity@example.com'},handle:'mxmx_test_identity',profileImage:{bytes,contentType:'image/png'},signIn:async()=>({cookie:'session=actual'}),send});
 expect(identity).toEqual({id:'usr_actual',name:'Test identity',handle:'mxmx_test_identity',image:'http://localhost:3030/api/users/usr_actual/avatar'});
 expect(calls.map(call=>[new URL(call.url).pathname,call.options.method])).toEqual([['/api/my/profile','PATCH'],['/api/my/profile/image','PUT'],['/api/auth/get-session','GET'],['/api/my/profile','GET']]);
 expect(calls.every(call=>call.options.headers.cookie==='session=actual'&&!call.options.headers.authorization)).toBe(true);
 expect(calls[1].options.body).toBe(bytes);
 expect(JSON.stringify(identity)).not.toContain('session');
});

it('publishes the same scoped real-identity fixture inputs with server-specific substitutions',async()=>{
 const {publishBaselineFixtures}=await import('../fixtures/component-baseline/publication.mjs');
 const {identityBrowserParityFixtures}=await import('../fixtures/component-baseline/identity.mjs');
 const before=JSON.stringify(identityBrowserParityFixtures),bodies=[];
 const entries=await publishBaselineFixtures({implementation:'jsx',fixtures:identityBrowserParityFixtures,substitutions:{identityId:'usr_actual',identityDataset:'DatasetActual',identityImage:'http://localhost:3030/api/users/usr_actual/avatar'},publish:async body=>{bodies.push(body);return {id:'PageActual'};}});
 expect(entries).toHaveLength(6);
 expect(bodies[0].markup).toContain('userId="usr_actual"');
 expect(bodies[0].markup).toContain('src="ref:DatasetActual"');
 expect(bodies.at(-1).markup).toContain('http://localhost:3030/api/users/usr_actual/avatar');
 expect(bodies.every(body=>!body.markup.includes('{{identity'))).toBe(true);
 expect(JSON.stringify(identityBrowserParityFixtures)).toBe(before);
});
