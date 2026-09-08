import {afterEach,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {recordOtpResponses} from '../lib/gate-otp-response.mjs';
afterEach(()=>vi.unstubAllGlobals());
it('records only the exact same-origin OTP POST, clones its body, and returns the original without replay',async()=>{
 const responses=[];
 const fetch=vi.fn(async()=>{const response=new Response('{"success":true}');responses.push(response);return response;});
 const browser={fetch,location:{href:'https://example.test/login'}};vi.stubGlobal('window',browser);
 recordOtpResponses();
 const original=await browser.fetch('/api/auth/email-otp/send-verification-otp',{method:'POST'});
 expect(original).toBe(responses[0]);expect(original.bodyUsed).toBe(false);
 await vi.waitFor(()=>expect(browser.__gateOtpResponses[0].complete).toBe(true));
 expect(browser.__gateOtpResponses).toEqual([{status:200,body:'{"success":true}',complete:true}]);
 for(const [url,init] of [['/api/auth/email-otp/send-verification-otp',{}],['https://evil.test/api/auth/email-otp/send-verification-otp',{method:'POST'}],['/api/auth/email-otp/send-verification-otp?other=1',{method:'POST'}],['/api/auth/sign-in/email-otp',{method:'POST'}]])await browser.fetch(url,init);
 expect(fetch).toHaveBeenCalledTimes(5);expect(browser.__gateOtpResponses).toHaveLength(1);
 await browser.fetch(new Request('https://example.test/api/auth/email-otp/send-verification-otp',{method:'POST'}));
 await vi.waitFor(()=>expect(browser.__gateOtpResponses[1].complete).toBe(true));
 expect(fetch).toHaveBeenCalledTimes(6);expect(browser.__gateOtpResponses).toHaveLength(2);
});
it('installs before navigation and retains bounded no-code and exact first/resend request assertions',()=>{
 const gate=readFileSync(new URL('../gate-email-login.mjs',import.meta.url),'utf8');
 expect(gate.indexOf('page.addInitScript(recordOtpResponses)')).toBeLessThan(gate.indexOf('await page.goto('));
 expect(gate).toContain('await readOtpResponse(1)');expect(gate).toContain('await readOtpResponse(2)');
 expect(gate).toContain('timeout:10000');expect(gate).toContain('otpRequests===count');
 expect(gate).not.toContain('await res.text()');expect(gate).toContain('!/\\d{6}/.test(record.body)');
});
