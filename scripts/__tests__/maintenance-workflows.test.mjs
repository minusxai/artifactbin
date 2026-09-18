import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { parse } from 'yaml';
const root = resolve(import.meta.dirname, '../..');
const workflow = name => parse(readFileSync(resolve(root, '.github/workflows', name), 'utf8'));
it('keeps cloud deployment and paid smoke out of OSS', () => {
  for (const name of ['publish.yml', 'performance.yml', 'agent-smoke-nightly.yml', 'update-cli-version.yml']) {
    expect(existsSync(resolve(root, '.github/workflows', name)), name).toBe(false);
  }
});
it('exposes usable manual-only runtime maintenance', () => {
  const definition = workflow('cli-runtime.yml');
  expect(Object.keys(definition.on)).toEqual(['workflow_dispatch']);
  for (const job of Object.values(definition.jobs)) expect(job.if).toBeUndefined();
});
it('does not schedule copied paid agent jobs in OSS CI', () => {
  const definition = workflow('ci.yml');
  expect(definition.jobs).not.toHaveProperty('agent-smoke');
  expect(definition.jobs).not.toHaveProperty('mx-agent-trials');
  expect(definition.jobs.plan.outputs).not.toHaveProperty('agent-smoke');
  for (const job of Object.values(definition.jobs)) {
    expect(job.needs ?? []).not.toContain('agent-smoke');
    expect(job.needs ?? []).not.toContain('mx-agent-trials');
  }
});

it('publishes only successful main CI artifacts, including all lazy runtime assets', () => {
  const definition = workflow('release-cli.yml');
  expect(definition.on.workflow_run.workflows).toEqual(['ci']);
  expect(definition.jobs.release.if).toContain("github.event.workflow_run.conclusion == 'success'");
  const step = definition.jobs.release.steps.find(step => step.name === 'Download the binaries tested by this CI run');
  for (const name of ['afbin-runtime-', 'afbin-chromium-', 'afbin-sql-']) expect(step.run).toContain(name);
  expect(step.run).toContain('gh run download');
});
