import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import yaml from 'yaml';
import {planCi,checkCiResults} from '../lib/ci-plan.mjs';
it('company container changes produce an exact package and cannot pass with skipped or failed acceptance',()=>{
 const plan=planCi(['deploy/company/Dockerfile']);
 expect(plan.companyContainer).toBe(true);expect(plan.cliPack).toBe(true);
 const results={...Object.fromEntries(Object.entries(plan.jobs).map(([job,selected])=>[job,selected?'success':'skipped'])),'cli-pack':'success','company-container':'skipped'};
 expect(checkCiResults(plan,results)).toContain('company-container');
 results['company-container']='failure';expect(checkCiResults(plan,results)).toContain('company-container');
 results['company-container']='success';expect(checkCiResults(plan,results)).toEqual([]);
 expect(planCi(['README.md']).companyContainer).toBe(false);
 expect(planCi(['deploy/company/Dockerfile'],{testedRun:'123'}).companyContainer).toBe(false);
});
it('workflow waits for exact package, runs real Compose acceptance and blocks rollup',()=>{
 const workflow=yaml.parse(readFileSync(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8'));
 const job=workflow.jobs['company-container'];expect(job.needs).toContain('cli-pack');
 expect(job.steps.some(step=>step.with?.name==='afbin-npm-packages')).toBe(true);
 expect(job.steps.some(step=>step.run?.includes('deploy/company/ci-smoke.mjs'))).toBe(true);
 expect(workflow.jobs.test.needs).toContain('company-container');
 expect(readFileSync(new URL('../../deploy/company/Caddy.Dockerfile',import.meta.url),'utf8')).toContain('xcaddy build v2.11.7');
});
