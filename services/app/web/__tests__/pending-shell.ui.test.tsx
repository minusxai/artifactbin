import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ShellFrame } from '../Shell';
import { PageLoading } from '../PageLoading';

/**
 * A provisional frame is presentation only: it must not run the account side
 * effects the resolved frame runs, and its controls must not be operable for a
 * destination that has not mounted.
 */
const identify = vi.hoisted(() => vi.fn());
vi.mock('@/components/MixpanelClient', () => ({ MixpanelIdentify: () => { identify(); return null; } }));
vi.mock('@/components/PageChrome', () => ({ default: () => <header><button aria-label="Open page controls">Controls</button></header> }));
vi.mock('../session', () => ({ useSession: () => ({ session: { user: { id: 'u1', email: 'u@example.test' }, kind: 'account', mixpanel: { token: null, host: '' } } }) }));

it('a transient loading frame cannot start account side effects or expose active page controls', () => {
  identify.mockClear();
  render(<PageLoading />);
  expect(identify).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Open page controls').closest('[inert]')).not.toBeNull();
  expect(screen.getByLabelText('Loading page').closest('[inert]')).toBeNull();
  expect(screen.getByLabelText('Loading page').closest('[data-mx-page-pending]')).not.toBeNull();
});

it('the resolved app frame identifies the account and enables its controls', () => {
  identify.mockClear();
  const view = render(<ShellFrame pending><main /></ShellFrame>);
  expect(identify).not.toHaveBeenCalled();
  view.rerender(<ShellFrame><main /></ShellFrame>);
  expect(identify).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Open page controls').closest('[inert]')).toBeNull();
});
