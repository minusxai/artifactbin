import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ShellFrame } from '../Shell';
import { PageLoading } from '../PageLoading';

const adopt = vi.hoisted(() => vi.fn());
vi.mock('@/components/AdoptLegacyToken', () => ({ default: () => { adopt(); return null; } }));
vi.mock('@/components/PageChrome', () => ({ default: () => <header><button aria-label="Open page controls">Controls</button></header> }));

it('a transient loading frame cannot exchange credentials or expose active page controls', () => {
  adopt.mockClear();
  render(<PageLoading />);
  expect(adopt).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Open page controls').closest('[inert]')).not.toBeNull();
  expect(screen.getByLabelText('Loading page').closest('[inert]')).toBeNull();
  expect(screen.getByLabelText('Loading page').closest('[data-mx-page-pending]')).not.toBeNull();
});

it('the resolved app frame retains credential adoption and enables its controls', () => {
  adopt.mockClear();
  const view = render(<ShellFrame pending><main /></ShellFrame>);
  expect(adopt).not.toHaveBeenCalled();
  view.rerender(<ShellFrame><main /></ShellFrame>);
  expect(adopt).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('Open page controls').closest('[inert]')).toBeNull();
});
