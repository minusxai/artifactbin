/** Retired declaration routes disappear; current dataset query and write APIs remain. */
import {describe, expect, it} from 'vitest';
import {ROUTES} from '@/server/routes.generated';
import {URL_SPACE} from '@artifactbin/contracts';

describe('retired story doors', () => {
  it('removes page declaration endpoints while retaining dataset operations', () => {
    const paths = ROUTES.map(route => route.path);
    expect(paths).toContain('/api/artifacts/:id/query');
    expect(paths).toContain('/api/artifacts/:id/mutate');
    expect(paths).not.toContain('/a/:id/query');
    expect(paths).not.toContain('/a/:id/mutate');
    expect(paths).not.toContain('/api/query');
  });
  it('does not advertise declaration query and mutation page doors', () => {
    expect(URL_SPACE.page.doors).not.toContain('query');
    expect(URL_SPACE.page.doors).not.toContain('mutate');
  });
});
