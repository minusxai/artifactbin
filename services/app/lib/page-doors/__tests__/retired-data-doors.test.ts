/** SQL remains the page data contract; deprecated GraphQL doors must not be registered. */
import { describe, expect, it } from 'vitest';
import { URL_SPACE } from '@artifactbin/contracts';
import { ROUTES } from '@/server/routes.generated';

describe('retired data doors', () => {
  it('keeps the supported SQL route while removing GraphQL routes', () => {
    const paths = ROUTES.map(route => route.path);
    expect(paths.some(route => route.endsWith('/sql'))).toBe(true);
    expect(paths.filter(route => /\/graphql(?:\/|$)/.test(route))).toEqual([]);
  });
  it('does not advertise GraphQL as a page door', () => {
    expect(URL_SPACE.page.doors).not.toContain('graphql');
  });
});
