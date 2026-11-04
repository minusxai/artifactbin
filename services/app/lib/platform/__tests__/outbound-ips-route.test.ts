/**
 * GET /api/outbound-ips — the addresses this deployment's outbound traffic leaves from (`APP__OUTBOUND_IPS`), so an
 * agent or a page owner knows what a database firewall must allow. Public (no credential), cacheable, and an empty
 * list when the deployment has not configured any.
 */
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { mountRoutes } from '@/server/api';
import { overrideConfig } from '@/lib/platform/config';

const app = new Hono();
mountRoutes(app);

describe('GET /api/outbound-ips', () => {
  it('answers the configured addresses without sign-in, cacheable for a short time', async () => {
    overrideConfig({ outboundIps: ['184.169.146.94', '2600:1f1c::1'] });
    const response = await app.request('/api/outbound-ips');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ips: ['184.169.146.94', '2600:1f1c::1'] });
    expect(response.headers.get('cache-control')).toBe('public, max-age=300');
  });

  it('answers an empty list when the deployment sets none', async () => {
    overrideConfig({ outboundIps: [] });
    const response = await app.request('/api/outbound-ips');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ips: [] });
  });
});
