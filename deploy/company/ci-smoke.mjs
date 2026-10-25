#!/usr/bin/env node
/** CI only: real containers, exact pack artifact, no mail/DNS provider requests.
 *
 *   node deploy/company/ci-smoke.mjs <candidate-dir> [--caddy-cache <dir> [--save-caddy-cache]] [--prepare-only] [-- <fetch command…>]
 *
 * Everything that does not need the package — the deployment directory, the Caddy and SMTP fixture images, the
 * PostgreSQL image — is prepared WHILE the fetch command (the current attempt's artifact waiter) brings the exact
 * cli-pack tarball into <candidate-dir>; only the app image and what follows wait for it. `--caddy-cache` is a BuildKit
 * local cache for the pinned Caddy build, used when the daemon's image store can import and export one (the
 * containerd store); `--prepare-only` builds that image (warming the cache) and stops.
 */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,cp,readFile,writeFile,readdir,rm,mkdir,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {initializeCompany} from './init.mjs';
const bundle=fileURLToPath(new URL('.',import.meta.url));
const separator=process.argv.indexOf('--'),options=process.argv.slice(2,separator<0?undefined:separator),fetchCommand=separator<0?[]:process.argv.slice(separator+1);
const flag=name=>{const index=options.indexOf(name);if(index<0)return false;options.splice(index,1);return true;};
const value=name=>{const index=options.indexOf(name);if(index<0)return undefined;const [,given]=options.splice(index,2);assert.ok(given,`${name} needs a value`);return resolve(given);};
const prepareOnly=flag('--prepare-only'),saveCaddyCache=flag('--save-caddy-cache'),caddyCache=value('--caddy-cache');
assert.ok(options.length<=1&&!options.some(option=>option.startsWith('--')),'Usage: ci-smoke.mjs <candidate-dir> [--caddy-cache <dir> [--save-caddy-cache]] [--prepare-only] [-- <fetch command>]');
const candidate=resolve(options[0]??'npm-candidate');
const DNS_MODULE='github.com/caddy-dns/route53@v1.6.2';
const scratch=await mkdtemp(join(tmpdir(),'company-container-')),first=join(scratch,'first'),restored=join(scratch,'restored');
const env={...process.env,AFBIN_PACKAGE:'/packages/afbin.tgz',COMPOSE_FILE:'compose.yaml:ci.override.yaml'};
const projects=new Map([[first,'afbin-company-ci-first'],[restored,'afbin-company-ci-restored']]);
const commandEnv=directory=>({...env,...(projects.has(directory)?{COMPOSE_PROJECT_NAME:projects.get(directory)}:{})});
function run(directory,program,args,{capture=false,timeout=180_000}={}){
 return execFileSync(program,args,{cwd:directory,env:commandEnv(directory),stdio:capture?['ignore','pipe','inherit']:'inherit',encoding:'utf8',timeout,maxBuffer:8*1024*1024});
}
/** The same command without blocking this process, so independent phases overlap. */
function runAsync(directory,program,args,{timeout=180_000,env:extra={}}={}){
 return new Promise((done,fail)=>{
  const child=spawn(program,args,{cwd:directory,env:{...commandEnv(directory),...extra},stdio:['ignore','inherit','inherit']});
  const timer=setTimeout(()=>child.kill('SIGKILL'),timeout);
  child.on('error',error=>{clearTimeout(timer);fail(error);});
  child.on('exit',(code,signal)=>{clearTimeout(timer);code===0?done():fail(Error(`${[program,...args].join(' ')} exited with ${signal??code}`));});
 });
}
function compose(directory,args,options){return run(directory,'docker',['compose',...args],options);}
function composeAsync(directory,args,options){return runAsync(directory,'docker',['compose',...args],options);}
/** Every independent phase finishes (no orphaned build or download) before the first failure is reported. */
async function together(...phases){
 const failed=(await Promise.allSettled(phases)).find(result=>result.status==='rejected');
 if(failed)throw failed.reason;
}
// The local cache needs an image store that can export one: the containerd store, never the classic docker store.
const cacheBackend=Boolean(caddyCache)&&/io\.containerd\.snapshotter/.test(execFileSync('docker',['info','--format','{{json .DriverStatus}}'],{encoding:'utf8'}));
if(caddyCache&&!cacheBackend)console.log('Caddy build cache unavailable: the Docker image store cannot import or export a BuildKit cache; building uncached.');
async function deploymentFiles(directory){
 await cp(bundle,directory,{recursive:true,filter:source=>!/(?:^|\/)(?:config|secrets|backups|node_modules|\.env|Caddyfile|dns-provider\.caddy)$/.test(source)});
 await configureFixture(directory,{caddyCache:cacheBackend});
 await initializeCompany(directory,{APP_HOSTNAME:'company.example.com',PAGES_HOSTNAME:'pages.company.example.com',OWNER_EMAIL:'mxmx_test_owner@example.com',ALLOWED_EMAIL_PATTERNS:'*@example.com',ACME_EMAIL:'mxmx_test_ops@example.com',DNS_MODULE,EMAIL__SMTP_HOST:'smtpfixture',EMAIL__SMTP_PORT:'2525',EMAIL__SMTP_SECURE:'false',EMAIL__SMTP_USER:'fixture-user',EMAIL__SMTP_PASSWORD:'fixture-password',EMAIL__FROM:'CI <login@example.com>'});
 await writeFile(join(directory,'dns-provider.caddy'),'tls {\n dns route53 {\n region ap-south-1\n }\n}\n');
 await writeFile(join(directory,'secrets/dns.env'),'AWS_EC2_METADATA_DISABLED=true\n');
}
async function configureFixture(directory,{caddyCache:cached=false}={}){
 for(const name of ['CI.smtp.Dockerfile','ci-smtp-fixture.mjs'])await cp(join(bundle,name),join(directory,name));
 // No caddy service runs in CI: real wildcard DNS/TLS acceptance belongs to the external host.
 await mkdir(join(directory,'ci-tls'));
 run(directory,'openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=smtpfixture','-addext','subjectAltName=DNS:smtpfixture','-keyout','ci-tls/key.pem','-out','ci-tls/cert.pem'],{capture:true});
 await chmod(join(directory,'ci-tls/key.pem'),0o600);
 // The pinned Caddy build is the same xcaddy compile on every run: imported from (and, when asked, exported to)
 // the BuildKit cache, it is seconds instead of ~85.
 const cache=cached?`
    build:
      cache_from: ['type=local,src=${caddyCache}']${saveCaddyCache?`
      cache_to: ['type=local,dest=${caddyCache},mode=min']`:''}`:'';
 // Health is polled every second while each container starts, so a ready service is seen at once rather than
 // at the next 5-10s interval; the checks themselves are the deployment's own.
 await writeFile(join(directory,'ci.override.yaml'),`services:
  caddy:
    profiles: [external]${cache}
  postgres:
    healthcheck:
      start_period: 60s
      start_interval: 1s
  app:
    environment:
      NODE_EXTRA_CA_CERTS: /fixture-ca/cert.pem
    volumes:
      - ./ci-tls/cert.pem:/fixture-ca/cert.pem:ro
    depends_on:
      smtpfixture: {condition: service_healthy}
    healthcheck:
      start_interval: 1s
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
      start_period: 30s
      start_interval: 1s
`);
}
const marker='company-container-persistence';
const screenshot=path=>`const {chromium}=require('/usr/local/lib/node_modules/@afbin/cli/node_modules/playwright');(async()=>{const b=await chromium.launch({headless:true});const p=await b.newPage();await p.setContent('<h1>Company export dependency check</h1>');await p.screenshot({path:'${path}'});await b.close();})().catch(e=>{console.error(e);process.exit(1)})`;
function databaseMarker(directory){return compose(directory,['exec','-T','postgres','psql','-U','artifactbin','-d','artifactbin','-Atc','SELECT value FROM hosting_acceptance.marker'],{capture:true}).trim();}
function artifactMarker(directory){return compose(directory,['exec','-T','app','node','-e',"process.stdout.write(require('node:fs').readFileSync('/data/data/hosting-acceptance.txt','utf8'))"],{capture:true}).trim();}
async function pinnedCaddy(){
 // Compose builds through Bake, which refuses a cache directory outside the project unless file-system
 // entitlements are granted; this CI-owned definition reads and writes only the named cache directory.
 await composeAsync(first,['build','caddy'],{timeout:300_000,env:cacheBackend?{BUILDX_BAKE_ENTITLEMENTS_FS:'0'}:{}});
 const modules=compose(first,['run','-T','--rm','--no-deps','caddy','list-modules'],{capture:true});assert.match(modules,/dns.providers.route53/);
 const caddyVersion=compose(first,['run','-T','--rm','--no-deps','caddy','version'],{capture:true});assert.match(caddyVersion,/^v2\.11\.7\b/);
}
let caddy=Promise.resolve();
try{
 await mkdir(candidate,{recursive:true});
 const deployment=deploymentFiles(first);
 // Nothing else runs Caddy, so its build and checks finish whenever they finish and are awaited last: a cold
 // compile (~90s) never holds the app image, which waits only for the package.
 caddy=deployment.then(pinnedCaddy);caddy.catch(()=>{});
 await together(
  // The exact package, from the current attempt only (scripts/lib/ci-artifact-wait.mjs), while the rest prepares.
  fetchCommand.length&&!prepareOnly?runAsync(process.cwd(),fetchCommand[0],fetchCommand.slice(1),{timeout:240_000}):Promise.resolve(),
  prepareOnly?caddy:deployment.then(()=>together(
   composeAsync(first,['build','smtpfixture'],{timeout:300_000}),
   // Build and test the runtime source packages while the exact candidate is being packed.
   runAsync(first,'docker',['build','--target','runtime-packages','-t','afbin-runtime-packages-ci','.'],{timeout:300_000}),
   composeAsync(first,['pull','--quiet','postgres'],{timeout:300_000}),
  )),
  prepareOnly?Promise.resolve():mkdir(restored).then(()=>configureFixture(restored)),
 );
 if(prepareOnly)console.log(JSON.stringify({status:'prepared',caddyCache:cacheBackend?caddyCache:null}));
 else await acceptance();
}catch(error){
 for(const directory of projects.keys()){try{compose(directory,['logs','--no-color','--tail','80']);}catch{}}
 throw error;
}finally{
 // The runner is discarded after this job: one second to stop is enough for every service here (the SMTP fixture,
 // a bare `node` PID 1, would otherwise hold teardown for Docker's full ten-second SIGTERM timeout).
 await Promise.allSettled([...projects.keys()].map(directory=>composeAsync(directory,['down','--volumes','--remove-orphans','--timeout','1'])));
 await rm(scratch,{recursive:true,force:true});
}
async function acceptance(){
 const tarballs=(await readdir(candidate)).filter(name=>/^afbin-cli-[\d.]+\.tgz$/.test(name));
 assert.equal(tarballs.length,1,'One exact cli-pack tarball is required; no registry fallback');
 await cp(join(candidate,tarballs[0]),join(first,'packages/afbin.tgz'));
 compose(first,['build','volume-init'],{timeout:300_000});
 compose(first,['up','-d','--wait','--wait-timeout','90','app']);
 const osInventory=compose(first,['exec','-T','app','dpkg-query','-W','-f=${binary:Package}\t${Version}\n'],{capture:true});
 const evidence=process.env.RUNNER_TEMP??scratch;
 await writeFile(join(evidence,'company-os-packages.tsv'),osInventory);
 await writeFile(join(evidence,'company-os-image.json'),JSON.stringify({source:process.env.GITHUB_SHA??null,image:compose(first,['images','-q','app'],{capture:true}).trim()},null,2)+'\n');
 const runtimePackages=compose(first,['exec','-T','app','sh','-ec',
  "dpkg-query -W tar dash libpcre2-8-0 libexpat1 coreutils ncurses-bin libtinfo6; test \"$(dpkg-query -W -f='${Version}' tar)\" = 1.35+fedora10-1+runtime1; test \"$(dpkg-query -W -f='${Version}' dash)\" = 0.5.12+libcfnmatch-1+runtime1; test \"$(dpkg-query -W -f='${Version}' libpcre2-8-0)\" = 10.49-1+runtime1; dpkg --compare-versions \"$(dpkg-query -W -f='${Version}' libexpat1)\" eq 2.9.0+security20261023-1+runtime1; test \"$(dpkg-query -W -f='${Version}' coreutils)\" = 9.12-1+runtime1; test \"$(dpkg-query -W -f='${Version}' ncurses-bin)\" = 6.6-1+runtime1; test \"$(dpkg-query -W -f='${Version}' libtinfo6)\" = 6.6-1+runtime1; timeout 5 dash -c 'value=$(printf \"%050000d\" 0 | tr 0 .); case \"$value\" in *.*.*.*.*.tar.gz) exit 1;; *) printf \"libc matcher stress passed\\n\";; esac'"
 ],{capture:true});
 console.log('Installed runtime package proof: '+runtimePackages.trim());
 // Proof executables stay in the source output image, never in the shipped app.
 const tools=join(scratch,'native-runtime-tools');await mkdir(tools);
 const proofContainer=run(first,'docker',['create','afbin-runtime-packages-ci','/unused'],{capture:true}).trim();
 try{run(first,'docker',['cp',`${proofContainer}:/test-tools/.`,tools]);}
 finally{run(first,'docker',['rm',proofContainer]);}
 const appImage=compose(first,['images','-q','app'],{capture:true}).trim();
 await runAsync(first,'docker',['run','--rm','--network','none','--entrypoint','node','--mount',`type=bind,src=${tools},dst=/test-tools,readonly`,appImage,'/test-tools/check-browser-libraries.mjs'],{timeout:60_000});


 const uid=compose(first,['exec','-T','app','node','-p','process.getuid()'],{capture:true});assert.notEqual(uid.trim(),'0');
 compose(first,['exec','-T','app','node','-e',"fetch('http://127.0.0.1:7445/api/auth/email-otp/send-verification-otp',{method:'POST',headers:{'content-type':'application/json',origin:'https://company.example.com'},body:JSON.stringify({email:'mxmx_test_owner@example.com',type:'sign-in'})}).then(r=>{if(!r.ok)throw Error('SMTP email-code request failed:'+r.status)}).catch(e=>{console.error(e.message);process.exit(1)})"]);
 const delivered=(await readFile(join(first,'ci-tls/messages.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 assert.ok(delivered.some(message=>message.to.includes('mxmx_test_owner@example.com')&&/\b\d{6}\b/.test(message.body)&&/^From: CI <login@example.com>$/m.test(message.body.replace(/\r/g,''))),'Normal owner email-code delivery reached the authenticated STARTTLS sink');
 const tables=compose(first,['exec','-T','postgres','psql','-U','artifactbin','-d','artifactbin','-Atc',"SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')"],{capture:true});assert.ok(Number(tables)>0,'Real app/auth database migrations ran');
 compose(first,['exec','-T','postgres','psql','-U','artifactbin','-d','artifactbin','-v','ON_ERROR_STOP=1','-c',`CREATE SCHEMA hosting_acceptance; CREATE TABLE hosting_acceptance.marker(value text); INSERT INTO hosting_acceptance.marker VALUES ('${marker}');`]);
 compose(first,['exec','-T','app','node','-e',`require('node:fs').writeFileSync('/data/data/hosting-acceptance.txt','${marker}')`]);
 // Exercise the package's pinned lazy installer and the installed Chromium's Linux dependencies.
 compose(first,['exec','-T','app','afbin','setup','--service','chromium','--json'],{timeout:120_000});
 compose(first,['exec','-T','app','node','-e',screenshot('/data/data/hosting-browser.png')],{timeout:60_000});
 compose(first,['restart','app','postgres']);compose(first,['up','-d','--wait','--wait-timeout','90','app']);
 assert.equal(databaseMarker(first),marker);assert.equal(artifactMarker(first),marker);
 const backup=join(scratch,'backup');run(first,'sh',['backup.sh',backup]);
 const config=await readFile(join(first,'config/server.env'));
 compose(first,['stop','app']);
 // Recovery starts with the restore script and test-only SMTP fixtures; all build inputs come from the backup.
 await cp(join(bundle,'restore.sh'),join(restored,'restore.sh'));
 run(restored,'sh',['restore.sh',backup],{timeout:180_000});
 compose(restored,['up','-d','--wait','--wait-timeout','90','app']);
 assert.equal(databaseMarker(restored),marker);assert.equal(artifactMarker(restored),marker);
 assert.deepEqual(await readFile(join(restored,'config/server.env')),config,'Persistent auth secret and database configuration survived restore');
 assert.deepEqual(await readFile(join(restored,'backup.sh')),await readFile(join(bundle,'backup.sh')),'The recovered deployment retains its backup helper');
 compose(restored,['exec','-T','app','node','-e',"if(require('node:fs').statSync('/data/data/hosting-browser.png').size<100)process.exit(1)"]);
 // The backup leaves out the re-installable Chromium download; the restored deployment installs it again and exports.
 compose(restored,['exec','-T','app','node','-e',"if(require('node:fs').existsSync('/data/chromium'))process.exit(1)"]);
 compose(restored,['exec','-T','app','afbin','setup','--service','chromium','--json'],{timeout:120_000});
 compose(restored,['exec','-T','app','node','-e',screenshot('/data/data/restored-browser.png')],{timeout:60_000});
 compose(restored,['exec','-T','app','node','-e',"if(require('node:fs').statSync('/data/data/restored-browser.png').size<100)process.exit(1)"]);
 await caddy;
 console.log(JSON.stringify({status:'passed',package:tarballs[0],sha256:createHash('sha256').update(await readFile(join(candidate,tarballs[0]))).digest('hex'),checks:['exact-package-image','pinned-caddy-route53','nonroot-app','authenticated-starttls-email-code','postgres-migrations','chromium-install-and-screenshot','restart-persistence','consistent-backup','fresh-restore','persistent-auth-secret','restored-chromium-reinstall']}));
}
