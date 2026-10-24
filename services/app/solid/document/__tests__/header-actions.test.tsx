/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { Route, Router } from '@solidjs/router';
import { screen, within } from '@testing-library/dom';
import { fireEvent, render } from '@/solid/__tests__/helpers';
import type { ComponentProps } from 'solid-js';
import { DocumentChrome } from '../DocumentChrome';

afterEach(() => vi.unstubAllGlobals());

function mount(capabilities: Partial<Pick<ComponentProps<typeof DocumentChrome>, 'owner' | 'canFork' | 'install' | 'membership' | 'archived'>> = {}) {
  const options = { owner: true, canFork: true, install: true, membership: 'join' as const, ...capabilities };
  const comment = vi.fn(), fork = vi.fn(), share = vi.fn(), membership = vi.fn();
  window.history.replaceState(null, '', '/header-test');
  render(() => <Router><Route path="/header-test" component={() => <DocumentChrome
    id="example" title={() => 'A readable artifact title'} author={{ username: 'example_author_with_a_long_name', id: 'author' }}
    follow={{ userId: 'author', following: false, count: 0 }} like={{ liked: false, count: 0 }} signedIn={() => true}
    comments={() => 3} panel={() => null} setPanel={() => {}}
    mode={() => 'light'} onMode={() => {}} onComment={comment} onFork={fork} onShare={share}
    onMembership={membership} controls={() => <p>Controls</p>} {...options} />}/></Router>);
  return { comment, fork, share, membership };
}

it.each([390, 700])('retains compact header actions in a reachable menu at %ipx', async (width) => {
  vi.stubGlobal('innerWidth', width);
  const actions = mount();
  fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
  expect(actions.comment).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Open artifact controls' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open menu' })).toBeInTheDocument();
  const open = await screen.findByRole('button', { name: 'More artifact actions' });
  fireEvent.click(open);
  const menu = await screen.findByRole('menu', { name: 'Artifact actions' });
  for (const name of ["View @example_author_with_a_long_name's profile", 'Follow @example_author_with_a_long_name', 'Like', 'Fork artifact', 'Install app', 'Share', 'Join artifact', 'Star artifactbin on GitHub']) {
    expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
  }
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'Fork artifact' }));
  expect(actions.fork).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
  expect(open).toHaveFocus();
});

it('returns the direct desktop actions after resizing', async () => {
  vi.stubGlobal('innerWidth', 700);
  mount();
  expect(await screen.findByRole('button', { name: 'More artifact actions' })).toBeInTheDocument();
  vi.stubGlobal('innerWidth', 1280);
  fireEvent(window, new Event('resize'));
  expect(screen.queryByRole('button', { name: 'More artifact actions' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Follow @example_author_with_a_long_name' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Fork artifact' })).toBeInTheDocument();
});

it('preserves capability and archived guards in the compact action menu', async () => {
  vi.stubGlobal('innerWidth', 700);
  mount({ owner: false, canFork: false, install: false, membership: undefined, archived: { version: 1, head: 2 } });
  expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'More artifact actions' }));
  const menu = await screen.findByRole('menu', { name: 'Artifact actions' });
  for (const name of ['Like', 'Fork artifact', 'Install app', 'Share', 'Join artifact']) {
    expect(within(menu).queryByRole('menuitem', { name })).toBeNull();
  }
  expect(within(menu).getByRole('menuitem', { name: 'Follow @example_author_with_a_long_name' })).toBeInTheDocument();
  expect(within(menu).getByRole('menuitem', { name: 'Version 1 of 2 · read-only' })).toBeDisabled();
  fireEvent.keyDown(menu, { key: 'Escape' });
  expect(screen.queryByRole('menu')).toBeNull();
  expect(await screen.findByRole('button', { name: 'More artifact actions' })).toHaveFocus();
});

it('keeps reading actions while excluding unavailable owner and install capabilities', async () => {
  vi.stubGlobal('innerWidth', 390);
  mount({ owner: false, canFork: false, install: false, membership: undefined });
  fireEvent.click(await screen.findByRole('button', { name: 'More artifact actions' }));
  const menu = await screen.findByRole('menu', { name: 'Artifact actions' });
  expect(within(menu).getByRole('menuitem', { name: 'Like' })).toBeInTheDocument();
  for (const name of ['Fork artifact', 'Install app', 'Share', 'Join artifact']) {
    expect(within(menu).queryByRole('menuitem', { name })).toBeNull();
  }
});

it.each([390, 700])('shows historical version context beside the compact title before opening actions at %ipx', (width) => {
  vi.stubGlobal('innerWidth', width);
  mount({ archived: { version: 1, head: 2 } });
  const version = screen.getByLabelText('Version 1 of 2 · read-only');
  expect(version).toHaveTextContent('v1');
  expect(version.parentElement).toHaveTextContent('A readable artifact title');
  expect(screen.queryByRole('menu')).toBeNull();
});
