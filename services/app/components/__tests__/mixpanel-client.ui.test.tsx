/**
 * Mixpanel wiring: init fires only when a token is configured (dev/CI machines
 * without one must send NOTHING), and identify attaches the session user only
 * AFTER init — mixpanel-browser, unlike posthog-js, hard-errors on pre-init
 * calls, and layout effects run child-first (shell Identify before root init),
 * so the ordering gate is itself the behavior under test. The gate lives in
 * module state, so every test re-imports a fresh copy of the module.
 */
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mixpanel = vi.hoisted(() => ({
  init: vi.fn(),
  identify: vi.fn(),
  people: { set: vi.fn() },
}));
vi.mock('mixpanel-browser', () => ({ default: mixpanel }));

/** jsdom serves from localhost; production assertions need a real-looking host. */
const setHostname = (hostname: string) =>
  Object.defineProperty(window, 'location', {
    value: { ...window.location, hostname },
    writable: true,
    configurable: true,
  });

/** The init→identify gate is module state — each test gets a fresh module. */
const importFresh = async () => {
  vi.resetModules();
  return import('@/components/MixpanelClient');
};

beforeEach(() => {
  mixpanel.init.mockClear();
  mixpanel.identify.mockClear();
  mixpanel.people.set.mockClear();
  setHostname('artifactbin.dev');
});

describe('MixpanelClient', () => {
  it('initializes with the configured token and host', async () => {
    const { default: MixpanelClient } = await importFresh();
    render(<MixpanelClient token="mp_test" host="https://api-js.mixpanel.com" />);
    await waitFor(() => expect(mixpanel.init).toHaveBeenCalledOnce());
    expect(mixpanel.init.mock.calls[0][0]).toBe('mp_test');
    expect(mixpanel.init.mock.calls[0][1]).toMatchObject({
      api_host: 'https://api-js.mixpanel.com',
      record_sessions_percent: 100,
      record_mask_text_selector: '',
    });
  });

  it('does nothing without a token', async () => {
    const { default: MixpanelClient } = await importFresh();
    render(<MixpanelClient token={null} host="https://api-js.mixpanel.com" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(mixpanel.init).not.toHaveBeenCalled();
  });

  it('sends from localhost too — the token is the only gate', async () => {
    setHostname('localhost');
    const { default: MixpanelClient } = await importFresh();
    render(<MixpanelClient token="mp_test" host="https://api-js.mixpanel.com" />);
    await waitFor(() => expect(mixpanel.init).toHaveBeenCalledOnce());
  });

  it('identifies the session user, but only after init', async () => {
    const { default: MixpanelClient, MixpanelIdentify } = await importFresh();
    // Identify mounts FIRST — in prod the shell layout (child) effects run
    // before the root layout's init effect, so this is the real sequence.
    render(
      <>
        <MixpanelIdentify userId="usr_1" email="v@minusx.ai" />
        <MixpanelClient token="mp_test" host="https://api-js.mixpanel.com" />
      </>,
    );
    await waitFor(() => expect(mixpanel.identify).toHaveBeenCalledWith('usr_1'));
    expect(mixpanel.people.set).toHaveBeenCalledWith({ $email: 'v@minusx.ai' });
    expect(mixpanel.init.mock.invocationCallOrder[0]).toBeLessThan(mixpanel.identify.mock.invocationCallOrder[0]);
  });

  it('never identifies while analytics is off — there is no init to attach to', async () => {
    const { default: MixpanelClient, MixpanelIdentify } = await importFresh();
    render(
      <>
        <MixpanelIdentify userId="usr_1" email="v@minusx.ai" />
        <MixpanelClient token={null} host="https://api-js.mixpanel.com" />
      </>,
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(mixpanel.identify).not.toHaveBeenCalled();
    expect(mixpanel.people.set).not.toHaveBeenCalled();
  });
});
