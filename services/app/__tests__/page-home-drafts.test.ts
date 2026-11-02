import { expect, it } from 'vitest';
import { GET as home } from '@/app/api/page/home/route';
import { createGuestOwner, request, useAppHarness } from './harness';
useAppHarness();
it('ignores legacy cookies on the anonymous home shelf', async () => {
  const guest = await createGuestOwner();
  for (const part of ['', '?part=core', '?part=insights']) {
    const response = await home(request('/api/page/home' + part, { cookie: guest.cookie }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ signedIn: false });
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
});
