import fs from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import {JSDOM} from 'jsdom';
import {loginViaEmail,passTheWelcomePage,startMailSink} from '../lib/mail-login.mjs';

it('reports initial navigation/resource/session failures without credential values or an extra wait',async()=>{
 const original=new Error('form timeout');
 const waits=[];
 // Protocol events only: this fixture never invents or renders an Email field.
 const page=new EventEmitter();
 page.goto=async()=>{
  const request={resourceType:()=> 'script',url:()=> 'https://example.test/assets/entry.js?token=never_log_this',failure:()=>({errorText:'net::ERR_FAILED'})};
  page.emit('requestfailed',request);
  page.emit('response',{request:()=>({resourceType:()=> 'fetch'}),url:()=> 'https://example.test/api/page/session',status:()=>200,json:async()=>({kind:'none',user:null,token:'never_log_this'})});
  return{status:()=>200};
 };
 page.url=()=> 'https://example.test/login?callbackUrl=never_log_this';
 page.waitForSelector=async(selector,options)=>{waits.push({selector,...options});throw original;};
 let failure;
 try{await loginViaEmail(page,'https://example.test',{},'mxmx_test_gate@example.com');}catch(error){failure=error;}
 expect(failure?.message).toContain('navigation HTTP 200, path=/login, session=HTTP 200, kind=none, user=false');
 expect(failure?.message).toContain('script /assets/entry.js: net::ERR_FAILED');
 expect(failure?.message).not.toContain('never_log_this');
 expect(failure?.cause).toBe(original);
 expect(waits).toEqual([{selector:'[aria-label="Email"]',timeout:45000}]);
 for(const event of ['requestfailed','pageerror','response'])expect(page.listenerCount(event)).toBe(0);
});

it('retains bounded structural welcome diagnostics without tokens, codes or workspace text',async()=>{
 const dom=new JSDOM('<div id="root"><main aria-label="Loading page">private workspace secret</main></div><script src="/assets/main.js?token=never_log_this"></script>',{url:'https://example.test/'});
 vi.stubGlobal('document',dom.window.document);
 const fetch=vi.fn(async()=>new Response(JSON.stringify({kind:'account',onboarded:false,user:{email:'mxmx_test_gate@example.com'},token:'never_log_this',code:'secret_code'})));
 vi.stubGlobal('fetch',fetch);
 try{
  const page={waitForFunction:async()=>({jsonValue:async()=> 'welcome'}),waitForURL:async()=>{throw Error('navigation missing');},
   url:()=> 'https://example.test/?token=never_log_this',evaluate:async(work,input)=>work(input)};
  let failure;try{await passTheWelcomePage(page,'mxmx_test_gate@example.com');}catch(error){failure=error;}
  expect(failure.message).toContain('"rootChildren":1');
  expect(failure.message).toContain('"scripts":["/assets/main.js"]');
  expect(failure.message).toContain('"expectedAccount":true');
  for(const secret of ['never_log_this','secret_code','private workspace secret'])expect(failure.message).not.toContain(secret);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
 }finally{vi.unstubAllGlobals();dom.window.close();}
});

it('keeps resource and session diagnostics through OTP navigation and removes listeners after welcome failure', async () => {
  const page = new EventEmitter();
  page.goto = async () => ({ status: () => 200 });
  page.url = () => 'https://example.test/?token=never_log_this';
  page.waitForSelector = async () => {};
  page.fill = async () => {};
  page.click = async selector => {
    if (selector !== '[aria-label="Verify code"]') return;
    page.emit('requestfailed', { resourceType: () => 'script', url: () => 'https://example.test/assets/home.js?token=never_log_this', failure: () => ({ errorText: 'net::ERR_FAILED' }) });
    page.emit('pageerror', new TypeError('private workspace text must not be included'));
    page.emit('response', { request: () => ({ resourceType: () => 'fetch' }), url: () => 'https://example.test/api/page/session', status: () => 503, json: async () => ({ kind: 'none', user: null, token: 'never_log_this' }) });
  };
  let waits = 0;
  page.waitForURL = async () => { if (++waits > 1) throw Error('welcome navigation missing'); };
  page.waitForFunction = async () => ({ jsonValue: async () => 'welcome' });
  page.evaluate = async () => ({ readyState: 'complete', rootChildren: 2, session: { kind: 'account', onboarded: false } });
  let failure;
  try { await loginViaEmail(page, 'https://example.test', { lastCode: () => '123456' }, 'mxmx_test_gate@example.com'); } catch (error) { failure = error; }
  expect(failure.message).toContain('script /assets/home.js: net::ERR_FAILED');
  expect(failure.message).toContain('page error: TypeError');
  expect(failure.message).toContain('session=HTTP 503, kind=none, user=false');
  expect(failure.message).toContain('session /api/page/session: HTTP 503');
  expect(failure.message).not.toContain('never_log_this');
  expect(failure.message).not.toContain('private workspace text');
  expect(failure.message).not.toContain('123456');
  for (const event of ['requestfailed', 'pageerror', 'response']) expect(page.listenerCount(event)).toBe(0);
});

it('reads the latest code per address from an explicit outbox ahead of the environment', async () => {
 const dir = fs.mkdtempSync(join(tmpdir(), 'mail-login-test-'));
 const explicit = join(dir, 'explicit.jsonl');
 const fromEnv = join(dir, 'env.jsonl');
 const alice = 'alice@example.test', bob = 'bob@example.test';
 const line = message => JSON.stringify(message) + '\n';
 vi.stubEnv('EMAIL__DEV_OUTBOX_PATH', fromEnv);
 try {
  fs.writeFileSync(fromEnv, line({ to: alice, otp: '999999' }));
  const sink = await startMailSink({ outboxPath: explicit });
  expect(sink.inbox).toEqual([]);
  expect(sink.lastCode(alice)).toBeNull();
  fs.writeFileSync(explicit, line({ to: alice, otp: '111111' }) + line({ to: alice, text: 'Your code is 222222.' }) + line({ to: bob, otp: '333333' }));
  expect(sink.lastCode(alice)).toBe('222222');
  expect(sink.lastCode(bob)).toBe('333333');
  expect(sink.lastCode()).toBe('333333');
  expect(sink.lastCode('missing@example.test')).toBeNull();
  expect((await startMailSink()).lastCode(alice)).toBe('999999');
 } finally {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
 }
});

it('reads the toolkit-relative default outbox when no path is supplied or configured', async () => {
 const fallback = fileURLToPath(new URL('../../.artifactbin/dev-mail.jsonl', import.meta.url));
 vi.stubEnv('EMAIL__DEV_OUTBOX_PATH', undefined);
 const original = fs.readFileSync;
 const read = vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
  if (file === fallback) return '{"to":"alice@example.test","otp":"123456"}\n';
  return original(file, ...args);
 });
 try {
  expect((await startMailSink()).lastCode('alice@example.test')).toBe('123456');
  expect(read).toHaveBeenCalledWith(fallback, 'utf8');
 } finally { read.mockRestore(); vi.unstubAllEnvs(); }
});
