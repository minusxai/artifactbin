import { expect, it } from 'vitest';
import config from '../../vitest.config.ts';

it('keeps real browser and Docker tests exclusively in the CI integration project', () => {
  const projects = config.test.projects.map(project => project.test);
  const node = projects.find(project => project.name === 'node');
  const integration = projects.find(project => project.name === 'integration');
  for (const file of [
    'services/browser/__tests__/contract.test.ts',
    'services/browser/__tests__/internal-assets.test.ts',
    'services/app/lib/datasets/__tests__/postgres.test.ts',
    'services/app/lib/datasets/__tests__/notebook-postgres.test.ts',
  ]) {
    expect(node.exclude, file).toContain(file);
    expect(integration.include.filter(included => included === file), file).toHaveLength(1);
  }
});
