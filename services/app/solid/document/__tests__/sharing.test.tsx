/* @jsxImportSource solid-js */
import { afterEach, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/dom';
import { fireEvent, render } from '../../__tests__/helpers';
import { DocumentSharing } from '../DocumentSharing';
import { createSignal } from 'solid-js';
import { stubFetch } from '@/test/helpers/fetch-stub';

afterEach(() => vi.unstubAllGlobals());

it('opens the owner sharing dialog and changes link visibility through the scoped endpoint', async () => {
  const state = { visibility: 'unlisted', linkRole: 'viewer', shares: [], canPrivate: true };
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => Response.json(init?.method === 'PUT' ? { ...state, visibility: 'public' } : state));
  vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByRole('dialog', { name: 'Sharing' })).toHaveTextContent('anyone with the link'));
  fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/my/artifacts/abc123/sharing', expect.objectContaining({ method: 'PUT', body: JSON.stringify({ visibility: 'public' }) })));
});

it('copies a clean reader link without loading ACLs', async () => {
  const copy = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner={false} url="/a/abc123?version=1#edit" />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  expect(copy).toHaveBeenCalledWith(`${location.origin}/a/abc123`);
  expect(fetcher).not.toHaveBeenCalled();
});

it('keeps the owner verdict current and closes with Escape', async () => {
  const state = { visibility: 'private', linkRole: 'viewer', shares: [], canPrivate: true };
  stubFetch({ 'PUT *': { ...state, visibility: 'public' } }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner />);
  await waitFor(() => expect(view.getByRole('button', { name: 'Share' })).toHaveTextContent('private'));
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Share' })).toHaveTextContent('public'));
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(screen.queryByRole('dialog', { name: 'Sharing' })).toBeNull();
});

it('invites an email, changes its role, and removes it under public visibility', async () => {
  const state = { visibility: 'public', linkRole: 'viewer', shares: [] as Array<{ email: string; role: string }>, canPrivate: true };
  stubFetch({
    'PUT *': (_url, init) => {
      const patch = JSON.parse(String(init!.body)) as { shares?: typeof state.shares };
      if (patch.shares) state.shares = patch.shares.map(person => ({ ...person, email: person.email.toLowerCase() }));
      return Response.json(state);
    },
  }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByText('people')).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Make public' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Make private' })).toHaveAttribute('aria-pressed', 'false');
  fireEvent.input(screen.getByRole('textbox', { name: 'Invite email' }), { target: { value: 'Friend@Example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add email' }));
  await waitFor(() => expect(state.shares).toEqual([{ email: 'friend@example.com', role: 'viewer' }]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Role for friend@example.com' })).toBeTruthy());
  expect(screen.getByRole('button', { name: 'Role for friend@example.com' }).closest('[data-slot="tooltip-trigger"]')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Role for friend@example.com' }));
  fireEvent.click(screen.getByRole('option', { name: 'can edit' }));
  await waitFor(() => expect(state.shares).toEqual([{ email: 'friend@example.com', role: 'editor' }]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Role for friend@example.com' }).closest('[data-slot="tooltip-trigger"]')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Remove friend@example.com' }));
  await waitFor(() => expect(state.shares).toEqual([]));
});

// A named COMMENTER from the row (the collab-roles gate's step 6b, moved here): the same role menu, the other role.
it('invites an email and makes them a commenter from the row', async () => {
  const state = { visibility: 'public', linkRole: 'viewer', shares: [] as Array<{ email: string; role: string }>, canPrivate: true };
  stubFetch({
    'PUT *': (_url, init) => {
      const patch = JSON.parse(String(init!.body)) as { shares?: typeof state.shares };
      if (patch.shares) state.shares = patch.shares;
      return Response.json(state);
    },
  }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByText('people')).toBeTruthy());
  fireEvent.input(screen.getByRole('textbox', { name: 'Invite email' }), { target: { value: 'commenter@example.com' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add email' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Role for commenter@example.com' })).toHaveTextContent('can view'));
  fireEvent.click(screen.getByRole('button', { name: 'Role for commenter@example.com' }));
  fireEvent.click(screen.getByRole('option', { name: 'can comment' }));
  await waitFor(() => expect(state.shares).toEqual([{ email: 'commenter@example.com', role: 'commenter' }]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Role for commenter@example.com' })).toHaveTextContent('can comment'));
});

it('offers view, comment and edit link roles and sends only the changed link role', async () => {
  const state = { visibility: 'unlisted', linkRole: 'viewer', shares: [] };
  const writes: unknown[] = [];
  stubFetch({
    'PUT *': (_url, init) => {
      const patch = JSON.parse(String(init!.body));
      writes.push(patch);
      Object.assign(state, patch);
      return Response.json(state);
    },
  }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const trigger = await waitFor(() => screen.getByRole('button', { name: 'Link role' }));
  expect(trigger.tagName).toBe('BUTTON');
  fireEvent.click(trigger);
  expect(screen.getAllByRole('option').map(option => option.textContent?.trim())).toEqual(['can view', 'can comment', 'can edit']);
  fireEvent.click(screen.getByRole('option', { name: 'can comment' }));
  await waitFor(() => expect(writes).toEqual([{ linkRole: 'commenter' }]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Link role' })).toHaveTextContent('can comment'));
});

it('hides the link role while private and restores the saved choice on return', async () => {
  const state = { visibility: 'private', linkRole: 'commenter', shares: [] };
  stubFetch({ 'PUT *': (_url, init) => { Object.assign(state, JSON.parse(String(init!.body))); return Response.json(state); } }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Make unlisted' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Link role' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Make unlisted' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Link role' })).toHaveTextContent('can comment'));
});

it('does not offer private visibility to an anonymous owner', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ visibility: 'unlisted', linkRole: 'viewer', shares: [], canPrivate: false })));
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Make public' })).toBeTruthy());
  expect(screen.queryByRole('button', { name: 'Make private' })).toBeNull();
});

it('offers social preview to an editor without sharing controls and keeps the editor reachable on image failure', () => {
  const edit = vi.fn(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner={false} onSocialPreview={edit} version={3} />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  expect(screen.getByRole('dialog', { name: 'Sharing' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Make public' })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
  const image = screen.getByAltText('Current social preview');
  expect(image.getAttribute('src')).toContain('/a/abc123/export?format=jpg&mode=card&v=3&');
  fireEvent.error(image);
  expect(screen.getByText('Preview unavailable')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Edit social preview' }));
  expect(edit).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog', { name: 'Sharing' })).toBeNull();
});

it('refreshes the social thumbnail and loading state when the saved document version changes', () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  let changeVersion!: (version: number) => void;
  const view = render(() => {
    const [version, setVersion] = createSignal(3);
    changeVersion = setVersion;
    return <DocumentSharing id="abc123" title="Report" owner={false} onSocialPreview={() => {}} version={version()} />;
  });
  expect(view.queryByAltText('Current social preview')).toBeNull();
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const image = screen.getByAltText('Current social preview');
  expect(image.getAttribute('src')).toContain('v=3&');
  fireEvent.load(image);
  expect(screen.queryByText('Loading preview…')).toBeNull();
  changeVersion(4);
  expect(screen.getByAltText('Current social preview').getAttribute('src')).toContain('v=4&');
  expect(screen.getByText('Loading preview…')).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
});


it('warns a document editor that a link does not grant dataset access and links its datasets', async () => {
  const fetcher = vi.fn(async () => Response.json({ visibility: 'unlisted', linkRole: 'viewer', shares: [] }));
  vi.stubGlobal('fetch', fetcher);
  render(() => <DocumentSharing id="abc123" title="Report" owner variant="dialog"
    refs={[{ id: 'ds1234', kind: 'dataset' }, { id: 'img123', kind: 'image' }]} />);
  await waitFor(() => expect(screen.getByText(/This link shares the document, not access to its datasets/)).toBeTruthy());
  expect(screen.getByRole('link', { name: 'Review dataset ds1234 sharing' })).toHaveAttribute('href', '/a/ds1234');
  expect(screen.queryByRole('link', { name: /img123/ })).toBeNull();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('keeps dataset sharing guidance out of private documents and reader views', async () => {
  const state = { visibility: 'private', linkRole: 'viewer', shares: [], canPrivate: true };
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(state)));
  render(() => <DocumentSharing id="abc123" title="Report" owner variant="dialog"
    refs={[{ id: 'ds1234', kind: 'dataset' }]} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Make private' })).toBeTruthy());
  expect(screen.queryByText(/This link shares the document/)).toBeNull();
});


it('does not disclose dependency guidance or request ACLs to ordinary readers', () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(() => <DocumentSharing id="abc123" title="Report" owner={false} variant="dialog"
    refs={[{ id: 'ds1234', kind: 'dataset' }]} />);
  expect(screen.queryByRole('complementary', { name: 'Dataset access when sharing' })).toBeNull();
  expect(screen.queryByRole('link', { name: /ds1234/ })).toBeNull();
  expect(fetcher).not.toHaveBeenCalled();
});

it('chooses a dataset\'s writes from a pressed-state group, and re-pressing the current choice sends nothing', async () => {
  const state = { visibility: 'public', linkRole: 'viewer', shares: [], access: 'read', writtenBy: [] as Array<{ id: string; title: string | null; mutations: string[] }> };
  const puts: unknown[] = [];
  stubFetch({ 'PUT *': (_url, init) => { const patch = JSON.parse(String(init!.body)); puts.push(patch); Object.assign(state, patch); return Response.json(state); } }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentSharing id="abc123" title="Data" owner format="dataset" />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const group = await waitFor(() => screen.getByRole('group', { name: 'Dataset writes' }));
  expect(screen.getByRole('group', { name: 'Link visibility' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Make read-only' })).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Make read & write' }));
  await waitFor(() => expect(puts).toEqual([{ access: 'readwrite' }]));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Make read & write' })).toHaveAttribute('aria-pressed', 'true'));
  // The group survived the refetch (same buttons, not rebuilt): focus is not lost to a remount.
  expect(group.isConnected).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Make read & write' }));
  expect(puts).toHaveLength(1);
});


it('disables public visibility when deployment policy forbids it while keeping link sharing usable', async () => {
  const fetcher = vi.fn(async () => Response.json({ visibility: 'unlisted', linkRole: 'viewer', shares: [], canPublic: false, canPrivate: true }));
  vi.stubGlobal('fetch', fetcher);
  render(() => <DocumentSharing id="abc123" title="Report" owner variant="dialog" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Make public' })).toBeDisabled());
  expect(screen.getByText(/Public documents are disabled on this server/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Make unlisted' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Make private' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it('shows a structured server refusal without marking the unsaved visibility selected', async () => {
  stubFetch({ 'PUT *': () => Response.json({ error: 'public_not_enabled', hint: 'Public documents are disabled. Use unlisted to share a link.' }, { status: 400 }) },
    { fallback: () => Response.json({ visibility: 'private', linkRole: 'viewer', shares: [], canPublic: true, canPrivate: true }) });
  render(() => <DocumentSharing id="abc123" title="Report" owner variant="dialog" />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Make public' })).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Make public' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Public documents are disabled. Use unlisted to share a link.'));
  expect(screen.getByRole('button', { name: 'Make private' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'Make public' })).toHaveAttribute('aria-pressed', 'false');
});

it('shows an Admin each query of the page on live data, approves one after saying what readers will see, and revokes it', async () => {
  const state = { visibility: 'private', linkRole: 'viewer', shares: [], canPrivate: true, canApproveQueries: true };
  const query = { name: 'totals', connection: 'default:', sql: 'select region, sum(amount) from wh.sales group by region', params: {}, hash: 'a'.repeat(64),
    statement: 'Everyone signed in with their own account who can open this page, including people who later join a group that can open it, will see what totals returns as Team sees it. They cannot change anything in it. While it is approved, only an Admin of Team may change this page\'s sharing. Editing the query, its connection or what readers may vary ends the approval.' };
  let approval: null | { id: string; approved_by: { name: string; username: null }; approved_at: string } = null;
  const fetcher = stubFetch({
    'GET /api/artifacts/abc123/query-approvals': () => Response.json({ group: { id: 'grp_1', name: 'Team' }, queries: [{ ...query, approval }] }),
    'POST /api/artifacts/abc123/query-approvals': () => { approval = { id: 'pqa_1', approved_by: { name: 'Ada', username: null }, approved_at: '2026-11-19T00:00:00.000Z' }; return Response.json({ id: 'pqa_1' }, { status: 201 }); },
    'DELETE /api/artifacts/abc123/query-approvals/pqa_1': () => { approval = null; return new Response(null, { status: 204 }); },
  }, { fallback: () => Response.json(state) });
  const view = render(() => <DocumentSharing id="abc123" title="Report" owner queryApprovals />);
  fireEvent.click(view.getByRole('button', { name: 'Share' }));
  const section = await screen.findByRole('group', { name: 'Approved queries' });
  expect(section).toHaveTextContent('runs as each reader');
  fireEvent.click(screen.getByRole('button', { name: 'Approve totals' }));
  const confirm = await screen.findByRole('dialog', { name: 'Show totals as Team sees it?' });
  expect(confirm).toHaveTextContent(query.statement);
  expect(confirm).toHaveTextContent(query.sql);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm approve totals' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith('/api/artifacts/abc123/query-approvals', expect.objectContaining({ method: 'POST', body: JSON.stringify({ query: 'totals', hash: query.hash }) })));
  await waitFor(() => expect(screen.getByRole('group', { name: 'Approved queries' })).toHaveTextContent('runs as Team · approved by Ada'));
  fireEvent.click(screen.getByRole('button', { name: 'Revoke totals' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm revoke totals' }));
  await waitFor(() => expect(screen.getByRole('group', { name: 'Approved queries' })).toHaveTextContent('runs as each reader'));
});

it('never asks for approved queries unless the sharing answer says the viewer may approve them: no request, so no refusal, for anyone else', async () => {
  for (const state of [
    { visibility: 'private', linkRole: 'viewer', shares: [], canPrivate: true, canApproveQueries: false },
    { visibility: 'private', linkRole: 'viewer', shares: [], canPrivate: true },
  ]) {
    const fetcher = stubFetch({ 'GET /api/artifacts/abc123/query-approvals': () => Response.json({ error: 'forbidden' }, { status: 403 }) }, { fallback: () => Response.json(state) });
    const view = render(() => <DocumentSharing id="abc123" title="Report" owner queryApprovals />);
    fireEvent.click(view.getByRole('button', { name: 'Share' }));
    await waitFor(() => expect(screen.getByText('people')).toBeTruthy());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetcher).not.toHaveBeenCalledWith('/api/artifacts/abc123/query-approvals', expect.anything());
    expect(screen.queryByRole('group', { name: 'Approved queries' })).toBeNull();
    view.unmount();
  }
});
