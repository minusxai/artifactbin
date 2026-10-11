#!/usr/bin/env node
/** CI only: real containers, exact pack artifact, no mail/DNS provider requests. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtemp,cp,readFile,writeFile,readdir,rm,mkdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeCompany} from './init.mjs';
const bundle=fileURLToPath(new URL('.',import.meta.url)),candidate=resolve(process.argv[2]??'npm-candidate');
const tarballs=(await readdir(candidate)).filter(name=>/^afbin-cli-[\d.]+\.tgz$/.test(name));
assert.equal(tarballs.length,1,'One exact cli-pack tarball is required; no registry fallback');
const scratch=await mkdtemp(join(tmpdir(),'company-container-')),first=join(scratch,'first'),restored=join(scratch,'restored');
const env={...process.env,AFBIN_PACKAGE:'/packages/afbin.tgz',COMPOSE_FILE:'compose.yaml:ci.override.yaml'};
const projects=new Map([[first,'afbin-company-ci-first'],[restored,'afbin-company-ci-restored']]);
function run(directory,program,args,{capture=false,timeout=180_000}={}){
 return execFileSync(program,args,{cwd:directory,env:{...env,COMPOSE_PROJECT_NAME:projects.get(directory)},stdio:capture?['ignore','pipe','inherit']:'inherit',encoding:'utf8',timeout,maxBuffer:8*1024*1024});
}
function compose(directory,args,options){return run(directory,'docker',['compose',...args],options);}
async function copyBundle(directory){
 await cp(bundle,directory,{recursive:true,filter:source=>!/(?:^|\/)(?:config|secrets|backups|node_modules|\.env|Caddyfile|dns-provider\.caddy)$/.test(source)});
 await cp(join(candidate,tarballs[0]),join(directory,'packages/afbin.tgz'));
 await configureFixture(directory);
}
async function configureFixture(directory){
 await cp(join(bundle,'CI.smtp.Dockerfile'),join(directory,'CI.smtp.Dockerfile'));
 // No caddy service runs in CI: real wildcard DNS/TLS acceptance belongs to the external host.
 await mkdir(join(directory,'ci-tls'));
 run(directory,'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=smtpfixture','-addext','subjectAltName=DNS:smtpfixture','-keyout','ci-tls/key.pem','-out','ci-tls/cert.pem']);
 await chmod(join(directory,'ci-tls/key.pem'),0o600);
 await writeFile(join(directory,'ci.override.yaml'),`services:
  caddy:
    profiles: [external]
  app:
    environment:
      NODE_EXTRA_CA_CERTS: /fixture-ca/cert.pem
    volumes:
      - ./ci-tls/cert.pem:/fixture-ca/cert.pem:ro
    depends_on:
      smtpfixture: {condition: service_healthy}
  smtpfixture:
    build:
      context: .
      dockerfile: CI.smtp.Dockerfile
    user: '\${APP_UID}:\${APP_GID}'
    volumes: [./ci-tls:/fixture]
    networks: [frontend]
    healthcheck:
      test: [CMD, node, -e, "const s=require('node:net').connect(2525,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1))"]
      interval: 2s
      timeout: 3s
      retries: 15
`);
}
const marker='company-container-persistence';
function databaseMarker(directory){return compose(directory,['exec','-T','postgres','psql','-U','artifactbin','-d','artifactbin','-Atc','SELECT value FROM hosting_acceptance.marker'],{capture:true}).trim();}
function artifactMarker(directory){return compose(directory,['exec','-T','app','node','-e',"process.stdout.write(require('node:fs').readFileSync('/data/data/hosting-acceptance.txt','utf8'))"],{capture:true}).trim();}
try{
 await copyBundle(first);
 await initializeCompany(first,{APP_HOSTNAME:'company.example.com',PAGES_HOSTNAME:'pages.company.example.com',OWNER_EMAIL:'mxmx_test_owner@example.com',ALLOWED_EMAIL_PATTERNS:'*@example.com',ACME_EMAIL:'mxmx_test_ops@example.com',DNS_MODULE:'github.com/caddy-dns/route53@v1.6.2',EMAIL__SMTP_HOST:'smtpfixture',EMAIL__SMTP_PORT:'2525',EMAIL__SMTP_SECURE:'false',EMAIL__SMTP_USER:'fixture-user',EMAIL__SMTP_PASSWORD:'fixture-password',EMAIL__FROM:'CI <login@example.com>'});
 await writeFile(join(first,'dns-provider.caddy'),'tls {\n dns route53 {\n region ap-south-1\n }\n}\n');
 await writeFile(join(first,'secrets/dns.env'),'AWS_EC2_METADATA_DISABLED=true\n');
 compose(first,['build','volume-init','caddy','smtpfixture'],{timeout:300_000});
 const modules=compose(first,['run','-T','--rm','--no-deps','caddy','list-modules'],{capture:true});assert.match(modules,/dns.providers.route53/);
 const caddyVersion=compose(first,['run','-T','--rm','--no-deps','caddy','version'],{capture:true});assert.match(caddyVersion,/^v2\.11\.7\b/);
 compose(first,['up','-d','--wait','--wait-timeout','90','app']);
 const uid=compose(first,['exec','-T','app','node','-p','process.getuid()'],{capture:true});assert.notEqual(uid.trim(),'0');
 compose(first,['exec','-T','app','node','-e',"fetch('http://127.0.0.1:7445/api/auth/email-otp/send-verification-otp',{method:'POST',headers:{'content-type':'application/json',origin:'https://company.example.com'},body:JSON.stringify({email:'mxmx_test_owner@example.com',type:'sign-in'})}).then(r=>{if(!r.ok)throw Error('SMTP email-code request failed:'+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})"]);
 const delivered=(await readFile(join(first,'ci-tls/messages.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.ok(delivered.some(message=>message.to.includes('mxmx_test_owner@example.com')&&/\b\d{6}\b/.test(message.body)&&/^From: CI <login@example.com>$/m.test(message.body.replace(/\r/g,''))),'Normal owner email-code delivery reached the authenticated STARTTLS sink');
 const tables=compose(first,['exec','-T','postgres','psql','-U','artifactbin','-d','artifactbin','-Atc',"SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')"],{capture:true});assert.ok(Number(tables)>0,'Real app/auth database migrations ran');
 compose(first,['exec','-T','postgres','psql','-U','artifactbin','-d','artifactbin','-v','ON_ERROR_STOP=1','-c',`CREATE SCHEMA hosting_acceptance; CREATE TABLE hosting_acceptance.marker(value text); INSERT INTO hosting_acceptance.marker VALUES ('${marker}');`]);
 compose(first,['exec','-T','app','node','-e',`require('node:fs').writeFileSync('/data/data/hosting-acceptance.txt','${marker}')`]);
 // Exercise the package's pinned lazy installer and the installed Chromium's Linux dependencies.
 compose(first,['exec','-T','app','afbin','setup','--service','chromium','--json'],{timeout:120_000});
 compose(first,['exec','-T','app','node','-e',"const {chromium}=require('/usr/local/lib/node_modules/@afbin/cli/node_modules/playwright');(async()=>{const b=await chromium.launch({headless:true});const p=await b.newPage();await p.setContent('<h1>Company export dependency check</h1>');await p.screenshot({path:'/data/data/hosting-browser.png'});await b.close();})().catch(e=>{console.error(e);process.exit(1)})"],{timeout:60_000});
 compose(first,['restart','app','postgres']);compose(first,['up','-d','--wait','--wait-timeout','90','app']);
 assert.equal(databaseMarker(first),marker);assert.equal(artifactMarker(first),marker);
 const backup=join(scratch,'backup');run(first,'sh',['backup.sh',backup]);
 const config=await readFile(join(first,'config/server.env'));
 compose(first,['stop','app']);
 // Recovery starts with the restore script and test-only SMTP fixtures; all build inputs come from the backup.
 await mkdir(restored);
 await cp(join(bundle,'restore.sh'),join(restored,'restore.sh'));
 await configureFixture(restored);run(restored,'sh',['restore.sh',backup],{timeout:180_000});
 compose(restored,['up','-d','--wait','--wait-timeout','90','app']);
 assert.equal(databaseMarker(restored),marker);assert.equal(artifactMarker(restored),marker);
 assert.deepEqual(await readFile(join(restored,'config/server.env')),config,'Persistent auth secret and database configuration survived restore');
 compose(restored,['exec','-T','app','node','-e',"if(require('node:fs').statSync('/data/data/hosting-browser.png').size<100)process.exit(1)"]);
 console.log(JSON.stringify({status:'passed',package:tarballs[0],sha256:createHash('sha256').update(await readFile(join(candidate,tarballs[0]))).digest('hex'),checks:['exact-package-image','pinned-caddy-route53','nonroot-app','authenticated-starttls-email-code','postgres-migrations','chromium-install-and-screenshot','restart-persistence','consistent-backup','fresh-restore','persistent-auth-secret']}));
}catch(error){
 for(const directory of projects.keys()){try{compose(directory,['logs','--no-color','--tail','80']);}catch{}}
 throw error;
}finally{
 for(const directory of projects.keys()){try{compose(directory,['down','--volumes','--remove-orphans']);}catch{}}
 await rm(scratch,{recursive:true,force:true});
}
