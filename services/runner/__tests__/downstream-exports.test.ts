/**
 * WHAT THE DEPLOYMENT IMPORTS FROM THE RUNNER. The private server repository (minusxai/artifactbin-server)
 * imports these source files by path from its `toolkit` checkout to build its runner; removing a name breaks that
 * build, which no other check here sees. Named imports, so knip's entry-export check (knip.config.js
 * `includeEntryExports`) counts them as used and refuses every other unused export. Regenerated from
 * artifactbin-server f1741b6 on 2026-11-03: change a line only together with that repository.
 */
import { expect, expectTypeOf, it } from 'vitest';
import { runnerIdentity, type HostCapabilitiesOptions } from '../src/capabilities';
import { createRunner } from '../src/local';

it('exports the values the deployment imports', () => {
  const values = { runnerIdentity, createRunner };
  for (const [name, value] of Object.entries(values)) expect(value, name).toBeDefined();
});

it('exports the types the deployment imports', () => {
  expectTypeOf<HostCapabilitiesOptions>().not.toBeNever();
});
