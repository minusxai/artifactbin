/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClaimBanner from '@/solid/components/ClaimBanner';
import SharedWithYou from '@/solid/components/SharedWithYou';
import { REFRESH_EVENT } from '@/web/page-data-events';
import type { WorkspaceSharedItem } from '@/lib/workspace';

const shared = (id: string, role: WorkspaceSharedItem['role'] = 'viewer'): WorkspaceSharedItem => ({ id, title: `doc ${id}`, description: null, format: 'markup', role, version: 1, visibility: 'private', updated_at: '2026-08-01T00:00:00.000Z', owner_username: 'alice' });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('keeps shared work absent when empty, and filters by role and search', () => {
  const blank = render(() => <SharedWithYou items={[]} />);
  expect(blank.container.innerHTML).toBe(''); blank.unmount();
  render(() => <SharedWithYou items={[shared('one'), shared('two', 'editor')]} />);
  expect(screen.getByLabelText('Your role on one')).toHaveTextContent('can view');
  expect(screen.getByLabelText('Open shared artifact one')).toHaveAttribute('href', '/a/one');
  fireEvent.click(screen.getByLabelText('Filter editor'));
  expect(screen.queryByLabelText('Open shared artifact one')).toBeNull();
  expect(screen.getByLabelText('Open shared artifact two')).toBeInTheDocument();
  fireEvent.input(screen.getByLabelText('Search shared artifacts'), { target: { value: 'one' } });
  expect(screen.queryByLabelText('Open shared artifact two')).toBeNull();
});

it('ANDs an external query (Home\'s own search box) with its own search box', () => {
  render(() => <SharedWithYou items={[shared('one'), shared('two')]} query="one" />);
  expect(screen.getByLabelText('Open shared artifact one')).toBeInTheDocument();
  expect(screen.queryByLabelText('Open shared artifact two')).toBeNull();
  // Its own box still narrows further within the external query's result, rather than replacing it.
  fireEvent.input(screen.getByLabelText('Search shared artifacts'), { target: { value: 'two' } });
  expect(screen.queryByLabelText('Open shared artifact one')).toBeNull();
});

it('names each recipient role and uses short artifact links even for untitled work', () => {
  render(() => <SharedWithYou items={[shared('one'), shared('two', 'editor'), { ...shared('three', 'commenter'), title: null, owner_username: null }]} />);
  expect(screen.getByLabelText('Your role on one')).toHaveTextContent('can view');
  expect(screen.getByLabelText('Your role on two')).toHaveTextContent('can edit');
  expect(screen.getByLabelText('Your role on three')).toHaveTextContent('can comment');
  expect(screen.getByLabelText('Shared with you')).toHaveTextContent('@alice');
  expect(screen.getByLabelText('Open shared artifact one')).toHaveAttribute('href', '/a/one');
  expect(screen.getByLabelText('Open shared artifact three')).toHaveAttribute('href', '/a/three');
  expect(screen.getByLabelText('Open shared artifact three')).toHaveTextContent('three');
});

const offers = [
  { tokenId: 'tok_a', titles: ['Alpha draft'], artifacts: 1 },
  { tokenId: 'tok_b', titles: ['Beta draft'], artifacts: 1 },
];
let rejected: string[];
let claimed: string[];
let failReject: boolean;
beforeEach(() => {
  rejected = []; claimed = []; failReject = false;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/claimable')) return Response.json({ claimable: offers });
    if (url.endsWith('/claim')) { claimed.push(JSON.parse(String(init?.body)).tokenId); return Response.json({ ok: true }); }
    if (url.endsWith('/reject')) { rejected.push(JSON.parse(String(init?.body)).tokenId); return failReject ? Response.json({}, { status: 404 }) : new Response(null, { status: 204 }); }
    return Response.json({});
  }));
});

it('claims only selected browser drafts and refreshes the page', async () => {
  const refreshed = vi.fn(); window.addEventListener(REFRESH_EVENT, refreshed);
  render(() => <ClaimBanner />);
  await screen.findByLabelText('Unclaimed drafts');
  fireEvent.click(screen.getByLabelText('Claim Beta draft'));
  fireEvent.click(screen.getByLabelText('Add to my account'));
  await waitFor(() => expect(claimed).toEqual(['tok_a']));
  await waitFor(() => expect(refreshed).toHaveBeenCalled());
  window.removeEventListener(REFRESH_EVENT, refreshed);
});

it('confirms rejection, retains the offer on failure, then removes it on success', async () => {
  failReject = true;
  render(() => <ClaimBanner />);
  await screen.findByText('Alpha draft');
  fireEvent.click(screen.getByLabelText('Reject tok_a'));
  expect(rejected).toEqual([]);
  fireEvent.click(screen.getByLabelText('Confirm reject'));
  await waitFor(() => expect(rejected).toEqual(['tok_a']));
  expect(await screen.findByText(/Could not reject/i)).toBeInTheDocument();
  expect(screen.getByText('Alpha draft')).toBeInTheDocument();
  failReject = false;
  fireEvent.click(screen.getByLabelText('Confirm reject'));
  await waitFor(() => expect(screen.queryByText('Alpha draft')).toBeNull());
});
