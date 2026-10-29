/** The direct-HTTP authentication guide served at /llms/http-auth. */
import {expect,it} from 'vitest';
import {publicGuideText} from '../../agent-copy';
it('teaches email login, the token grant, refresh and private credential storage',()=>{
 const auth=publicGuideText('http-auth','https://artifactbin.example')!;
 for(const text of ['/api/auth/email-otp/send-verification-otp','/api/authentication/token','account_created_this_login','has_created_document','Verified email sessions receive','refresh_token','client_id','persistent secret store','Atomically','/oauth/token'])expect(auth).toContain(text);
 expect(auth).not.toContain('there is no refresh token');
 expect(auth).not.toMatch(/afbin |\/docs\//);
});
