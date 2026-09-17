import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,realpath,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareServe} from '../src/serve-config';
import {teamSettings,serverInstructions} from '../src/team-config';
import {startupFailure} from '../src/operator-error';
// A network origin now needs a login method teammates can actually COMPLETE, so the shared fixture
// carries a whole one: the mail key alone leaves the sender at a default address a provider refuses.
const settings='APP__HOST=0.0.0.0\nAPP__PORT=7445\nAPP__PUBLIC_BASE_URL=https://team.example.test\nAUTH__SECRET='+ 's'.repeat(48)+'\nEMAIL__RESEND_API_KEY=re_fixture_key\nEMAIL__FROM=Team <team@example.test>\n';
test('team operator settings isolate database, objects, identity and service cache from the client and shell',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-'));
 try{
 const file=join(directory,'server.env');await writeFile(file,settings);
 const result=await teamSettings(file,{PATH:'/bin',ARTIFACTBIN_HOME:'/secret/client',ARTIFACTBIN_TOKEN:'secret',DATABASE_URL:'postgres://remote',AUTH__SECRET:'wrong',SQL__SERVICE_URL:'https://remote',S3_URL:'s3://remote'});
 assert.equal(result.host,'0.0.0.0');assert.equal(result.port,7445);assert.equal(result.origin,'https://team.example.test');
 assert.equal(result.env.DATABASE_URL,'pglite://'+join(result.directory,'data/pglite'));
 assert.equal(result.env.OBJECT_STORE__LOCAL_DIR,join(result.directory,'data/objects'));
 assert.equal(result.env.ARTIFACTBIN_HOME,join(result.directory,'data/runtime'));
 assert.equal(result.env.EMAIL__DEV_OUTBOX_PATH,join(result.directory,'data/outbox.jsonl'));
 assert.equal(result.env.AUTH__SECRET,'s'.repeat(48));assert.equal(result.env.EMAIL__FROM,'Team <team@example.test>');
 assert.equal(result.env.ARTIFACTBIN_TOKEN,undefined);assert.equal(result.env.SQL__SERVICE_URL,undefined);assert.equal(result.env.S3_URL,undefined);assert.equal(result.env.PATH,'/bin');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('team settings reject missing identity, malformed origins and unrelated namespaces',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-'));
 try{
 const file=join(directory,'server.env');
 for(const text of [settings.replace(/AUTH__SECRET=.*\n/,''),settings.replace('https://team.example.test','https://user:password@team.example.test'),settings+'SELF__PORT=0\n',settings+'PROXY__RATE_LIMIT_CONFIG_FILE=policy.yml\n',settings+'RATE_LIMITER__TRUSTED_PROXY_HOPS=1\n']){
 await writeFile(file,text);await assert.rejects(teamSettings(file),/team|Team/);
 }
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('team settings accept ordinary SQL limits and reject unrelated provider settings',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-settings-'));
 try{
  const file=join(directory,'server.env');await writeFile(file,settings+'SQL__MAX_QUERY_ROWS=300\n');
  assert.equal((await teamSettings(file)).env.SQL__MAX_QUERY_ROWS,'300');
  await writeFile(file,settings+'MODEL_PROVIDER__API_KEY=unused\n');
  await assert.rejects(teamSettings(file),/Unsupported team setting/);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('database overrides leave uploaded objects and client state in their own directories',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-serve-db-'));
 try{
  const file=join(directory,'server.env');await writeFile(file,settings);
  const pg=await teamSettings(file,{}, {dbUrl:'postgres://localhost/artifactbin'});
  assert.equal(pg.env.DATABASE_URL,'postgres://localhost/artifactbin');assert.equal(pg.env.OBJECT_STORE__LOCAL_DIR,join(pg.directory,'data/objects'));
  const embedded=await teamSettings(file,{}, {dbUrl:'pglite://custom-db'});
  assert.equal(embedded.env.DATABASE_URL,'pglite://'+join(embedded.directory,'custom-db'));
  await assert.rejects(teamSettings(file,{}, {dbUrl:'sqlite://data'}),/database URL/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

/**
 * Each case supplies everything the OTHER refusals want, so exactly one of them can fire and the
 * matched substring proves which. A server that starts is a server whose login page can be used.
 */
test('team settings refuse the network shapes teammates cannot sign in through, and keep the proxy and loopback ones',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-network-'));
 try{
  const file=join(directory,'server.env'),secret='AUTH__SECRET='+'s'.repeat(48)+'\n',login='EMAIL__RESEND_API_KEY=re_test_key\nEMAIL__FROM=Team <team@example.test>\n';
  const network=(origin:string,host='0.0.0.0')=>`APP__HOST=${host}\nAPP__PORT=7445\nAPP__PUBLIC_BASE_URL=${origin}\n`;
  await writeFile(file,network('http://artifacts.example.test')+secret+login);
  await assert.rejects(teamSettings(file),/only connect over HTTPS/);
  await writeFile(file,network('http://127.0.0.1:7445')+secret+login);
  await assert.rejects(teamSettings(file),/URL teammates use/);
  await writeFile(file,network('https://artifacts.example.test')+secret);
  await assert.rejects(teamSettings(file),/EMAIL__RESEND_API_KEY/);
  for(const provider of [
   'AUTH__GOOGLE_CLIENT_ID=id\nAUTH__GOOGLE_CLIENT_SECRET=shh\n',
   // OIDC by discovery: one URL stands in for the three endpoints (human.ts fetches it at init).
   'AUTH__OIDC_PROVIDER_ID=corp\nAUTH__OIDC_CLIENT_ID=id\nAUTH__OIDC_CLIENT_SECRET=shh\nAUTH__OIDC_DISCOVERY_URL=https://idp.example.test/.well-known/openid-configuration\n',
   // …or all three explicit endpoints, which is the no-fetch-at-boot shape.
   'AUTH__OIDC_PROVIDER_ID=corp\nAUTH__OIDC_CLIENT_ID=id\nAUTH__OIDC_CLIENT_SECRET=shh\nAUTH__OIDC_AUTHORIZATION_URL=https://idp.example.test/authorize\nAUTH__OIDC_TOKEN_URL=https://idp.example.test/token\nAUTH__OIDC_USERINFO_URL=https://idp.example.test/userinfo\n',
  ]){
   await writeFile(file,network('https://artifacts.example.test')+secret+provider);
   assert.equal((await teamSettings(file)).origin,'https://artifacts.example.test',provider);
  }
  /**
   * A login method that is NAMED but not COMPLETE is the refusal this check exists for: the server
   * boots, the login page offers the button, and the round trip dies at the provider. Each line here
   * is the only login setting present, so the refusal is about that method and nothing else.
   */
  for(const half of [
   // Resend without a sender: team-application defaults `from` to `artifactbin <login@example.com>`,
   // an address no real provider will send for, so every code is rejected on the way out.
   'EMAIL__RESEND_API_KEY=re_test_key\n',
   'EMAIL__RESEND_API_KEY=re_test_key\nEMAIL__FROM=   \n',
   'EMAIL__FROM=Team <team@example.test>\n',
   'AUTH__GOOGLE_CLIENT_ID=id\n',
   'AUTH__GOOGLE_CLIENT_SECRET=shh\n',
   // OIDC: the provider id alone configures NOTHING — better-auth still needs a client and either
   // discovery or the explicit endpoints, and `loginProvidersOf` never supplies a `userInfo` hook.
   'AUTH__OIDC_PROVIDER_ID=corp\n',
   'AUTH__OIDC_PROVIDER_ID=corp\nAUTH__OIDC_CLIENT_ID=id\nAUTH__OIDC_DISCOVERY_URL=https://idp.example.test/.well-known/openid-configuration\n',
   'AUTH__OIDC_PROVIDER_ID=corp\nAUTH__OIDC_CLIENT_ID=id\nAUTH__OIDC_CLIENT_SECRET=shh\n',
   'AUTH__OIDC_PROVIDER_ID=corp\nAUTH__OIDC_CLIENT_ID=id\nAUTH__OIDC_CLIENT_SECRET=shh\nAUTH__OIDC_AUTHORIZATION_URL=https://idp.example.test/authorize\nAUTH__OIDC_TOKEN_URL=https://idp.example.test/token\n',
  ]){
   await writeFile(file,network('https://artifacts.example.test')+secret+half);
   await assert.rejects(teamSettings(file),/no login method teammates can complete/,half);
  }
  // The refusal names the whole mail pair, because the key on its own is the tempting half-setup.
  await writeFile(file,network('https://artifacts.example.test')+secret+'EMAIL__RESEND_API_KEY=re_test_key\n');
  await assert.rejects(teamSettings(file),/EMAIL__FROM/);
  // A TLS proxy in front legitimately terminates elsewhere: --port picks the listener, the public URL still advertises.
  await writeFile(file,network('https://artifacts.example.test')+secret+login);
  const proxied=await teamSettings(file,{},{port:9000});
  assert.equal(proxied.port,9000);assert.equal(proxied.origin,'https://artifacts.example.test');
  // The generated single-machine default keeps working without any mail provider.
  await writeFile(file,network('http://127.0.0.1:7445','127.0.0.1')+secret);
  assert.equal((await teamSettings(file)).origin,'http://127.0.0.1:7445');
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('startup instructions name the host teammates set, the installer, and where login codes appear',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'afbin-team-instructions-'));
 try{
  const file=join(directory,'server.env'),secret='AUTH__SECRET='+'s'.repeat(48)+'\n';
  await writeFile(file,'APP__HOST=127.0.0.1\nAPP__PORT=7445\nAPP__PUBLIC_BASE_URL=http://127.0.0.1:7445\n'+secret);
  const single=await teamSettings(file),local=serverInstructions(single);
  assert.ok(local.every(line=>!line.includes('\n')),'one line each');
  assert.ok(local.some(line=>line.includes('afbin config set host http://127.0.0.1:7445')),local.join('\n'));
  assert.ok(local.some(line=>line.includes('curl -fsSL http://127.0.0.1:7445/chat/install.sh | sh')),local.join('\n'));
  assert.ok(local.some(line=>line.includes('[dev-mail] otp')&&line.includes(single.env.EMAIL__DEV_OUTBOX_PATH!)),local.join('\n'));
  const network='APP__HOST=0.0.0.0\nAPP__PORT=7445\nAPP__PUBLIC_BASE_URL=https://artifacts.example.test\n';
  await writeFile(file,network+'EMAIL__RESEND_API_KEY=re_test_key\nEMAIL__FROM=Team <team@example.test>\n'+secret);
  const published=serverInstructions(await teamSettings(file));
  assert.ok(published.some(line=>line.includes('afbin config set host https://artifacts.example.test')),published.join('\n'));
  assert.ok(published.some(line=>line.includes('curl -fsSL https://artifacts.example.test/chat/install.sh | sh')),published.join('\n'));
  assert.ok(!published.some(line=>line.includes('[dev-mail]')),published.join('\n'));
  assert.ok(published.some(line=>/mail provider/.test(line)),published.join('\n'));
  /**
   * WITHOUT a mailer, saying "a code was emailed" sends every teammate looking for mail nobody
   * sent: the host that only carries Google or OIDC has to say which button to press instead.
   */
  await writeFile(file,network+'AUTH__GOOGLE_CLIENT_ID=id\nAUTH__GOOGLE_CLIENT_SECRET=shh\n'+secret);
  const google=serverInstructions(await teamSettings(file));
  assert.ok(google.some(line=>/sign in with Google/.test(line)&&/not configured/.test(line)),google.join('\n'));
  assert.ok(!google.some(line=>/mail provider/.test(line)),google.join('\n'));
  await writeFile(file,network+'AUTH__OIDC_PROVIDER_ID=corp\nAUTH__OIDC_CLIENT_ID=id\nAUTH__OIDC_CLIENT_SECRET=shh\nAUTH__OIDC_DISCOVERY_URL=https://idp.example.test/.well-known/openid-configuration\n'+secret);
  const oidc=serverInstructions(await teamSettings(file));
  assert.ok(oidc.some(line=>/sign in with the corp provider/.test(line)&&/not configured/.test(line)),oidc.join('\n'));
  assert.ok(!oidc.some(line=>/mail provider/.test(line)),oidc.join('\n'));
  assert.ok([...google,...oidc].every(line=>!line.includes('\n')),'one line each');
 }finally{await rm(directory,{recursive:true,force:true});}
});
/**
 * A RELATIVE outbox path is documented as resolving beside `server.env` (docs/extraction/team.md),
 * and only `--dir` pointing somewhere else tells the two readings apart: the operator edited that
 * file, so the path they typed is relative to it, not to a data directory serve chose for them.
 */
test('a relative dev outbox path resolves beside server.env even when --dir points elsewhere',async()=>{
 const root=await mkdtemp(join(tmpdir(),'afbin-team-outbox-'));
 try{
  const file=join(root,'server.env'),data=join(root,'elsewhere');
  await mkdir(data,{recursive:true});
  await writeFile(file,'APP__HOST=127.0.0.1\nAPP__PORT=7445\nAPP__PUBLIC_BASE_URL=http://127.0.0.1:7445\nAUTH__SECRET='+'s'.repeat(48)+'\nEMAIL__DEV_OUTBOX_PATH=outbox.jsonl\n');
  const settings=await teamSettings(file,{},{directory:data}),beside=join(await realpath(root),'outbox.jsonl');
  assert.equal(settings.env.EMAIL__DEV_OUTBOX_PATH,beside);
  // And what startup prints is that same absolute path, not the operator's relative spelling.
  assert.ok(serverInstructions(settings).some(line=>line.includes(beside)),'absolute in the instructions');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('expected serve startup failures become one actionable line; anything else keeps its own report',()=>{
 const context={directory:'/srv/team',port:7445};
 const busy=startupFailure(new Error('workspace_busy: another afbin operation is using this directory. Retry when it finishes.'),context);
 assert.equal((busy as Error).message,'Another afbin serve is already using /srv/team.');
 const taken=startupFailure(Object.assign(new Error('listen EADDRINUSE: address already in use 0.0.0.0:7445'),{code:'EADDRINUSE'}),context);
 assert.equal((taken as Error).message,'Port 7445 is already in use; choose another with --port.');
 for(const failure of [busy,taken])assert.equal((failure as Error).name,'OperatorError');
 const unrelated=new Error('team application failed to boot');
 assert.equal(startupFailure(unrelated,context),unrelated);
 /**
  * ONCE THE LISTENER IS UP the translation stops. A server that has been serving for a day and then
  * hits EADDRINUSE (a socket it opened itself) is not an operator pointing at a taken port: "choose
  * another with --port" would be a lie, and the stack is the only evidence of what actually broke.
  */
 const serving={...context,started:true};
 const late=Object.assign(new Error('listen EADDRINUSE: address already in use 0.0.0.0:7445'),{code:'EADDRINUSE'});
 assert.equal(startupFailure(late,serving),late);
 const lateBusy=new Error('workspace_busy: another afbin operation is using this directory. Retry when it finishes.');
 assert.equal(startupFailure(lateBusy,serving),lateBusy);
});

test('first serve creates private persistent operator settings without client defaults',async()=>{
 const home=await mkdtemp(join(tmpdir(),'afbin-serve-init-'));
 try{
  const options={home,cwd:home,directory:'team',port:8123};
  const first=await prepareServe(options),bytes=await readFile(first.config,'utf8');
  assert.equal((await stat(first.config)).mode&0o777,0o600);
  assert.equal((await teamSettings(first.config,{},first.overrides)).port,8123);
  const again=await prepareServe({...options,port:8124,dbUrl:'postgres://localhost/app'});
  assert.equal(await readFile(again.config,'utf8'),bytes);
  const settings=await teamSettings(again.config,{},again.overrides);
  assert.equal(settings.port,8124);assert.equal(settings.origin,'http://127.0.0.1:8124');
  assert.equal(settings.env.DATABASE_URL,'postgres://localhost/app');
  await assert.rejects(stat(join(home,'.artifactbin/config.json')),{code:'ENOENT'});
 }finally{await rm(home,{recursive:true,force:true});}
});
