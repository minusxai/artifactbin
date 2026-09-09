import { describe, expect, it } from 'vitest';
import { createAppServer } from '../app';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();
const app = createAppServer({ indexHtml: async () => '<!doctype html><html><head><title>artifactbin</title></head><body><div id="root"></div></body></html>' });

describe('public homepage first response', () => {
  it('contains the landing content and topbar without executing JavaScript', async () => {
    const response = await app.request('/');
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('Your agents');
    expect(html).toContain('interactive HTML documents');
    expect(html).toContain('aria-label="Home"');
    expect(html).not.toContain('aria-label="Loading page"');
    expect(html).not.toContain('aria-label="Loading workspace"');
  });
});
