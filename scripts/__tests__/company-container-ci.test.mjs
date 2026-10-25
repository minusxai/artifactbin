import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import yaml from 'yaml';
import {planCi,checkCiResults} from '../lib/ci-plan.mjs';
it('company container changes produce an exact package and cannot pass with skipped or failed acceptance',()=>{
 const plan=planCi(['deploy/company/Dockerfile']);
 expect(plan.companyContainer).toBe(true);expect(plan.cliPack).toBe(true);
 const results={...Object.fromEntries(Object.entries(plan.jobs).map(([job,selected])=>[job,selected?'success':'skipped'])),'cli-pack':'success','company-source':'success','company-container':'skipped'};
 expect(checkCiResults(plan,results)).toContain('company-container');
 results['company-container']='failure';expect(checkCiResults(plan,results)).toContain('company-container');
 results['company-container']='success';expect(checkCiResults(plan,results)).toEqual([]);
 expect(planCi(['README.md']).companyContainer).toBe(false);
 expect(planCi(['deploy/company/Dockerfile'],{testedRun:'123'}).companyContainer).toBe(false);
});
it('workflow waits for exact package, runs real Compose acceptance and blocks rollup',()=>{
 const workflow=yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
 const job=workflow.jobs['company-container'];
 // Prepares beside cli-pack; the exact current-attempt tarball arrives through the shared waiter, not `needs`.
 expect(job.needs).toEqual(['plan']);
 expect(job.permissions).toEqual({contents:'read',actions:'read'});
 const smoke=job.steps.find(step=>step.name==='Build exact candidate and test PostgreSQL restart plus consistent recovery');
 expect(smoke.run).toContain('node scripts/lib/ci-artifact-wait.mjs --extract');
 expect(smoke.run).toContain('afbin-npm-packages "afbin-cli-$version.tgz"');
 expect(smoke.run).toContain('"${{ github.run_id }}" "${{ github.run_attempt }}"');
 expect(smoke.env.GH_TOKEN).toBe('${{ github.token }}');
 expect(job.steps.some(step=>step.uses?.startsWith('actions/download-artifact'))).toBe(false);
 expect(workflow.jobs.test.needs).toContain('company-container');
 expect(workflow.jobs.test.needs).toContain('company-source');
 expect(workflow.jobs.test.needs).toContain('cli-pack');
 // The universal tarball is published right after the signed release, before the seed transfers and archives.
 const pack=workflow.jobs['cli-pack'].steps,release=pack.findIndex(step=>step.with?.name==='afbin-npm-release');
 expect(pack.findIndex(step=>step.with?.name==='afbin-npm-packages')).toBe(release+1);
 expect(readFileSync(new URL('../../deploy/company/Caddy.Dockerfile',import.meta.url),'utf8')).toContain('xcaddy build v2.11.7');
});
it('reuses the pinned Caddy compile through a cache keyed on its inputs and resolved base images',()=>{
 const workflow=yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
 for(const name of ['company-container','warm-caches']){
  const steps=workflow.jobs[name].steps,key=steps.find(step=>step.id==='caddy-key'),cache=steps.find(step=>step.id==='caddy-cache');
  expect(key.run,name).toContain('deploy/company/Caddy.Dockerfile');
  expect(key.run,name).toContain('imagetools inspect');
  for(const input of ['Caddy.Dockerfile','caddy-entrypoint.sh','ci-smoke.mjs'])expect(key.run,name).toContain(`'deploy/company/${input}'`);
  expect(cache.uses,name).toMatch(/^actions\/cache@/);
  expect(cache.with.key,name).toBe('${{ steps.caddy-key.outputs.key }}');
  expect(steps.some(step=>step.run?.includes('scripts/ci/docker-containerd-store.sh')),name).toBe(true);
 }
 const warm=workflow.jobs['warm-caches'].steps.at(-1);
 expect(warm.if).toBe("steps.caddy-cache.outputs.cache-hit != 'true'");
 expect(warm.run).toContain('ci-smoke.mjs --prepare-only --caddy-cache');
 const smoke=workflow.jobs['company-container'].steps.find(step=>step.name==='Build exact candidate and test PostgreSQL restart plus consistent recovery');
 expect(smoke.run).toContain('--caddy-cache "$RUNNER_TEMP/company-caddy-cache" $SAVE_CADDY_CACHE');
 expect(smoke.env.SAVE_CADDY_CACHE).toBe("${{ steps.caddy-cache.outputs.cache-hit != 'true' && '--save-caddy-cache' || '' }}");
});
it('keeps every acceptance check while overlapping only independent preparation',()=>{
 const smoke=readFileSync(new URL('../../deploy/company/ci-smoke.mjs',import.meta.url),'utf8');
 for(const check of ['exact-package-image','pinned-caddy-route53','nonroot-app','authenticated-starttls-email-code','postgres-migrations','chromium-install-and-screenshot','restart-persistence','consistent-backup','fresh-restore','persistent-auth-secret'])expect(smoke).toContain(`'${check}'`);
 // The package decides the app image and everything after it; only those wait for the fetch.
 expect(smoke.indexOf("compose(first,['build','volume-init']")).toBeGreaterThan(smoke.indexOf('One exact cli-pack tarball is required'));
 expect(smoke).toContain("['down','--volumes','--remove-orphans','--timeout','1']");
 expect(smoke).toContain('cache_from');expect(smoke).toContain('io\\.containerd\\.snapshotter');
});

it('packaged SMTP acceptance uses a trusted private TLS sink and the normal owner email-code route',()=>{
 const smoke=readFileSync(new URL('../../deploy/company/ci-smoke.mjs',import.meta.url),'utf8');
 expect(smoke).toContain('NODE_EXTRA_CA_CERTS');
 expect(smoke).toContain('/api/auth/email-otp/send-verification-otp');
 expect(smoke).toContain('EMAIL__SMTP_SECURE');
 expect(smoke).toContain('authenticated-starttls-email-code');
 expect(smoke).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
 const fixture=readFileSync(new URL('../../deploy/company/CI.smtp.Dockerfile',import.meta.url),'utf8');
 expect(fixture).toContain('smtp-server@3.21.1');
});
it('reports PostgreSQL ready only once the real server listens, never the initialisation-time socket server',()=>{
 const compose=yaml.parse(readFileSync(new URL('../../deploy/company/compose.yaml',import.meta.url),'utf8'));
 // A socket probe reached the temporary server (FATAL: database "artifactbin" does not exist) once polled every second.
 expect(compose.services.postgres.healthcheck.test).toEqual(['CMD-SHELL','pg_isready -h 127.0.0.1 -U artifactbin -d artifactbin']);
});
it('backs up artifacts without the re-installable Chromium download and proves the restored deployment reinstalls it',()=>{
 const backup=readFileSync(new URL('../../deploy/company/backup.sh',import.meta.url),'utf8');
 expect(backup).toContain('--entrypoint tar volume-init -C /data --exclude=./chromium -czf - .');
 const smoke=readFileSync(new URL('../../deploy/company/ci-smoke.mjs',import.meta.url),'utf8');
 expect(smoke).toContain("'restored-chromium-reinstall'");
 const restored=smoke.slice(smoke.indexOf("run(restored,'sh',['restore.sh',backup]"));
 expect(restored).toContain("existsSync('/data/chromium'))process.exit(1)");
 expect(restored.indexOf("compose(restored,['exec','-T','app','afbin','setup','--service','chromium','--json']")).toBeGreaterThan(0);
 expect(restored).toContain("screenshot('/data/data/restored-browser.png')");
 expect(readFileSync(new URL('../../deploy/company/README.md',import.meta.url),'utf8')).toContain('leaves out `/data/chromium`');
});

it('requires every isolated source producer in the unchanged original workflow chain',()=>{
 const workflow=yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
 const producer=workflow.jobs['company-source'];
 expect(producer.needs).toEqual(['plan']);expect(producer.if).toBe("needs.plan.outputs.company-container == 'true'");
 expect(producer.strategy['fail-fast']).toBe(false);
 expect(producer.strategy.matrix.component).toEqual(['runtime-pcre2','runtime-tar','runtime-dash','runtime-expat','runtime-coreutils','runtime-ncurses','browser-xml','browser-cups','browser-sqlite','browser-xorg']);
 expect(producer.steps.find(step=>step.run?.includes(' produce ')).run).toContain('"${{ matrix.component }}"');
 expect(producer.steps.some(step=>step.if==='always()'&&step.with?.path.endsWith('/source-status.json'))).toBe(true);
 const plan=planCi(['scripts/lib/source-artifacts.mjs']);expect(plan.companyContainer).toBe(true);
 const results={...Object.fromEntries(Object.entries(plan.jobs).map(([job,selected])=>[job,selected?'success':'skipped'])),'cli-pack':'success','company-container':'success','company-source':'failure'};
 expect(checkCiResults(plan,results)).toContain('company-source');
 results['company-source']='skipped';expect(checkCiResults(plan,results)).toContain('company-source');
 results['company-source']='success';expect(checkCiResults(plan,results)).toEqual([]);
 const smoke=readFileSync(new URL('../../deploy/company/ci-smoke.mjs',import.meta.url),'utf8');
 expect(smoke).toContain("'collect',join(scratch,'source-components')");expect(smoke).toContain('RUNTIME_PACKAGES: afbin-runtime-packages-ci');
 expect(smoke).toContain('{timeout:300_000}');
});
