import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {useAppHarness} from './harness';
import {createTeamApplication} from '../../cli/src/team-application';
import {getDb} from '@/lib/db';
import {mintToken} from '@/lib/tokens';
import {AUTH_SECRET} from '@/lib/config';
useAppHarness();
it('team host composes real public auth and preserves separate owners and anonymous denial',async()=>{
 const origin='http://localhost:3000',directory=await mkdtemp(join(tmpdir(),'afbin-team-auth-'));
 try{
 const host=await createTeamApplication({APP__PUBLIC_BASE_URL:origin,AUTH__SECRET:AUTH_SECRET,PROXY__RATE_LIMIT_CONFIG_FILE:'/does-not-exist/production-policy.yml',EMAIL__DEV_OUTBOX_PATH:join(directory,'outbox.jsonl')},process.cwd());
 const bareStart=await host.fetch(new Request(origin+'/api/start',{method:'POST'}));
 expect(bareStart.status).toBe(201);
 const bareDocument=await bareStart.json();expect(bareDocument.id).toBeTruthy();
 expect(bareDocument).not.toHaveProperty('token');expect(bareDocument).not.toHaveProperty('expiresAt');
 expect(JSON.stringify(bareDocument)).not.toMatch(/mx_/);expect(bareStart.headers.get('set-cookie')).toContain('HttpOnly');
 const db=await getDb();
 await db.query('INSERT INTO users (id,email,name,username) VALUES ($1,$2,$3,$4),($5,$6,$7,$8)',
 ['usr_team1','mxmx_test_team1@example.test','First','team1','usr_team2','mxmx_test_team2@example.test','Second','team2']);
 const first=(await mintToken('first','usr_team1',db)).token,second=(await mintToken('second','usr_team2',db)).token;
 const create=await host.fetch(new Request(origin+'/api/artifacts',{method:'POST',headers:{authorization:'Bearer '+first,'content-type':'application/json'},body:JSON.stringify({markup:'<p>Team private</p>',visibility:'private'})}));
 expect(create.status).toBe(201);const artifact=await create.json();
 expect((await host.fetch(new Request(origin+'/api/artifacts/'+artifact.id,{headers:{authorization:'Bearer '+first}}))).status).toBe(200);
 for(const token of [undefined,second,'invalid']){
 const response=await host.fetch(new Request(origin+'/api/artifacts/'+artifact.id,{headers:token?{authorization:'Bearer '+token}:{}}));
 expect([401,404]).toContain(response.status);
 }
 const session=await host.fetch(new Request(origin+'/api/auth/get-session'));
 expect(session.status).toBe(200);expect(await session.json()).toBeNull();
 const bootstrap=await host.fetch(new Request(origin+'/_afbin/browser-ticket',{method:'POST',headers:{authorization:'Bearer '+first}}));
 expect(bootstrap.status).toBe(404);
 const email='mxmx_test_team_login@example.test';
 const authPost=(path:string,body:unknown)=>host.fetch(new Request(origin+'/api/auth'+path,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}));
 expect((await authPost('/email-otp/send-verification-otp',{email,type:'sign-in'})).status).toBe(200);
 const messages=(await readFile(join(directory,'outbox.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 const otp=messages.find(message=>message.to===email).otp;
 const login=await authPost('/sign-in/email-otp',{email,otp});expect(login.status).toBe(200);
 const cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
 expect(cookie).not.toBe('');
 const loggedIn=await host.fetch(new Request(origin+'/api/auth/get-session',{headers:{cookie}}));
 expect((await loggedIn.json()).user.email).toBe(email);
 // Existing device OAuth is assembled locally, including the protected mint boundary.
 expect((await host.fetch(new Request(origin+'/api/internal/tokens',{method:'POST'}))).status).toBe(404);
 const started=await host.fetch(new Request(origin+'/oauth/device',{method:'POST'}));expect(started.status).toBe(200);
 const pair=await started.json();
 const approved=await host.fetch(new Request(origin+'/oauth/device/approve',{method:'POST',headers:{cookie,origin},body:new URLSearchParams({user_code:pair.user_code})}));
 expect(approved.status).toBe(200);
 const poll=await host.fetch(new Request(origin+'/oauth/device/token',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({device_code:pair.device_code})}));
 expect(poll.status).toBe(200);const deviceToken=(await poll.json()).access_token;expect(deviceToken).toBeTruthy();

 // A real authenticated browser acquires its own app identity and can publish private documents.
 const browserCreate=await host.fetch(new Request(origin+'/api/my/artifacts',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({markup:'<p>Browser owner</p>',visibility:'private'})}));
 expect(browserCreate.status).toBe(201);
 const browserArtifact=await browserCreate.json();
 expect((await host.fetch(new Request(origin+'/api/artifacts/'+browserArtifact.id,{headers:{authorization:'Bearer '+deviceToken}}))).status).toBe(200);
 expect((await host.fetch(new Request(origin+'/api/my/artifacts/'+browserArtifact.id,{headers:{cookie}}))).status).toBe(200);
 expect([401,404]).toContain((await host.fetch(new Request(origin+'/api/artifacts/'+browserArtifact.id,{headers:{authorization:'Bearer '+first}}))).status);
 }finally{await rm(directory,{recursive:true,force:true});}
});
