import { expect, it } from 'vitest';
import { createAppServer, APP_CSP } from '../app';
import { useAppHarness } from '@/__tests__/harness';

useAppHarness();
it('serves a static widget sandbox, including for direct visits, without relaxing the parent policy', async () => {
  const response = await createAppServer().request('/-/github-star?theme=dark&url=https://evil.example');
  expect(response.status).toBe(200);
  const csp = response.headers.get('content-security-policy')!;
  expect(csp).toContain('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox');
  expect(csp).not.toContain('allow-same-origin');
  expect(csp).toContain('frame-src \'none\'');
  expect(csp).toContain('connect-src https://api.github.com');
  expect(response.headers.get('set-cookie')).toBeNull();
  const html = await response.text();
  expect(html).toContain('https://buttons.github.io/buttons.js');
  expect(html).toContain('https://github.com/minusxai/artifactbin');
  expect(html).not.toContain('evil.example');
  expect(APP_CSP).not.toContain('buttons.github.io');
});
