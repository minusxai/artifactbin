import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ShellFrame } from '../Shell';
import { PageLoading } from '../PageLoading';

/**
 * A provisional frame is presentation only: it must not run the account side
 * effects the resolved frame runs, and its controls must not be operable for a
 * destination that has not mounted.
 */
vi.mock('@/components/PageChrome', () => ({ default: () => <header><button aria-label="Open page controls">Controls</button></header> }));
vi.mock('../session', () => ({ useSession: () => ({ session: { user: { id: 'u1', email: 'u@example.test' }, kind: 'account' } }) }));

it('a transient loading frame cannot start account side effects or expose active page controls', () => {
  render(<PageLoading />);
  expect(screen.getByLabelText('Open page controls').closest('[inert]')).not.toBeNull();
  expect(screen.getByLabelText('Loading page').closest('[inert]')).toBeNull();
  expect(screen.getByLabelText('Loading page').closest('[data-mx-page-pending]')).not.toBeNull();
});

it('the resolved app frame enables its controls', () => {
  const view = render(<ShellFrame pending><main /></ShellFrame>);
  view.rerender(<ShellFrame><main /></ShellFrame>);
  expect(screen.getByLabelText('Open page controls').closest('[inert]')).toBeNull();
});
