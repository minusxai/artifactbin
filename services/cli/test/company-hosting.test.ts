import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CLI_VERSION} from '../src/version';
import {initializeCompany,validateInputs} from '../../../deploy/company/init.mjs';
const input={APP_HOSTNAME:'company.example.com',PAGES_HOSTNAME:'pages.company.example.com',OWNER_EMAIL:'owner@example.com',ALLOWED_EMAIL_PATTERNS:'*@example.com',ACME_EMAIL:'ops@example.com',DNS_MODULE:'github.com/caddy-dns/route53@v1.6.0',EMAIL__RESEND_API_KEY:'test-provider-key',EMAIL__FROM:'Company <login@example.com>'};
test('external hosting refuses incomplete login, unsafe origins and unpinned DNS module',()=>{
 for(const change of [{APP_HOSTNAME:'localhost'},{PAGES_HOSTNAME:'elsewhere.invalid'},{DNS_MODULE:'github.com/caddy-dns/route53'},{EMAIL__FROM:''},{AUTH__OIDC_CLIENT_ID:'incomplete'},{OWNER_EMAIL:'owner@example.com\nAUTH__INVITE_ONLY=false'}])assert.throws(()=>validateInputs({...input,...change}));
 assert.doesNotThrow(()=>validateInputs(input));
});
test('initialization keeps existing secrets and refuses overwriting a deployment',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'company-host-'));
 await initializeCompany(directory,input);
 const before=await readFile(join(directory,'config/server.env'),'utf8');
 assert.match(before,/DATABASE_URL=postgres:\/\/artifactbin:[a-f0-9]+@postgres:5432\/artifactbin/);
 assert.match(before,/APP__DEPLOYMENT_MODE=company/);assert.match(before,/AUTH__INVITE_ONLY=true/);
 assert.match(before,/AUTH__SECRET=[a-f0-9]{64}/);
 assert.equal((await stat(join(directory,'config/server.env'))).mode&0o777,0o600);
 await assert.rejects(initializeCompany(directory,input),/already initialized/);
 assert.equal(await readFile(join(directory,'config/server.env'),'utf8'),before);
});
test('compose exposes only HTTPS proxy and separates persistent storage',async()=>{
 const compose=await readFile(new URL('../../../deploy/company/compose.yaml',import.meta.url),'utf8');
 assert.equal((compose.match(/ports:/g)||[]).length,1);
 assert.match(compose,/80:80/);assert.match(compose,/443:443/);
 assert.match(compose,/postgres:17\.11-bookworm/);assert.match(compose,/postgres-data:\/var\/lib\/postgresql\/data/);
 assert.match(compose,/app-data:\/data/);assert.match(compose,/user:.*APP_UID/);
 assert.match(compose,/service_healthy/);assert.match(compose,/service_completed_successfully/);
 const docker=await readFile(new URL('../../../deploy/company/Dockerfile',import.meta.url),'utf8');
 assert.match(docker,/install-deps chromium/);
 assert.ok(docker.includes(`ARG AFBIN_VERSION=${CLI_VERSION}\n`));
 assert.ok(docker.includes(`ARG AFBIN_PACKAGE=@afbin/cli@${CLI_VERSION}\n`));
 assert.ok(compose.includes(`image: artifactbin-company:${CLI_VERSION}`));
 assert.ok(compose.includes(`AFBIN_PACKAGE:-@afbin/cli@${CLI_VERSION}`));
});

test('partial prior configuration is never overwritten and invalid inputs create no secrets',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'company-existing-'));
 await assert.rejects(initializeCompany(directory,{...input,EMAIL__FROM:''}));
 await assert.rejects(stat(join(directory,'config/server.env')));
 await writeFile(join(directory,'Caddyfile'),'existing operator configuration');
 await assert.rejects(initializeCompany(directory,input),/already initialized/);
 assert.equal(await readFile(join(directory,'Caddyfile'),'utf8'),'existing operator configuration');
});
test('backup stops writes before both snapshots and restore refuses populated storage',async()=>{
 const backup=await readFile(new URL('../../../deploy/company/backup.sh',import.meta.url),'utf8');
 assert.ok(backup.indexOf('stop app')<backup.indexOf('pg_dump'));
 assert.ok(backup.indexOf('stop app')<backup.indexOf('-czf - .'));
 assert.match(backup,/trap .*start app/);assert.match(backup,/configuration.tar.gz.*config secrets/);
 const restore=await readFile(new URL('../../../deploy/company/restore.sh',import.meta.url),'utf8');
 assert.match(restore,/up -d --wait postgres/);
 assert.ok(restore.indexOf('Database is not empty')<restore.indexOf('pg_restore'));
 assert.ok(restore.indexOf('Artifact volume is not empty')<restore.indexOf('-xzf -'));
});
test('SMTP initialization supports encrypted relay login and refuses ambiguous or incomplete credentials',async()=>{
 const smtp={...input,EMAIL__RESEND_API_KEY:undefined,EMAIL__SMTP_HOST:'smtp.example.com',EMAIL__SMTP_PORT:'587',EMAIL__SMTP_SECURE:'false',EMAIL__SMTP_USER:'operator',EMAIL__SMTP_PASSWORD:'smtp-fixture-password'};
 assert.doesNotThrow(()=>validateInputs(smtp));
 for(const change of [{EMAIL__SMTP_HOST:''},{EMAIL__SMTP_PORT:'0'},{EMAIL__SMTP_SECURE:'sometimes'},{EMAIL__SMTP_PASSWORD:''},{EMAIL__RESEND_API_KEY:'ambiguous-key'}])assert.throws(()=>validateInputs({...smtp,...change}));
 const directory=await mkdtemp(join(tmpdir(),'company-smtp-'));await initializeCompany(directory,smtp);
 const settings=await readFile(join(directory,'config/server.env'),'utf8');assert.match(settings,/EMAIL__SMTP_HOST=smtp.example.com/);assert.match(settings,/EMAIL__SMTP_SECURE=false/);assert.doesNotMatch(settings,/EMAIL__RESEND_API_KEY/);
});
