/* @jsxImportSource solid-js */
/**
 * A group's place in the tree, as a person sees and changes it (pages/GroupTree): the parent and subgroups, the
 * people who receive the group's files through a subgroup shown apart from its direct members, creating a subgroup
 * and moving the group with the server's refusals in plain words. `fetch` answers with the bodies the real handlers
 * return (`GET /api/groups/{id}`, `GET /api/groups`, `POST /api/groups`, `PUT /api/groups/{id}/parent`; their
 * shapes are pinned against the handlers in services/app/__tests__/groups-api.test.ts and lib/groups' tests).
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import type { GroupDetail } from '@artifactbin/contracts';
import { GroupManagement } from '../Group';
import { GroupTreePanel, GroupTreeSummary } from '../GroupTree';

const finance = { id: 'grp_finance', handle: 'finance', name: 'Finance', role: 'editor' as const };
const retail = { id: 'grp_retail', handle: 'retail', name: 'Retail', role: 'editor' as const };
const detail = (over: Partial<GroupDetail> = {}): GroupDetail => ({
  group: { id: 'grp_retail', handle: 'retail', name: 'Retail', description: '', role: 'editor', parent_id: null },
  members: [{ user_id: 'u_alice', username: 'alice', name: 'Alice', role: 'editor' }],
  linked_groups: [], invitations: [], parent: null, subgroups: [], subgroup_audience: [], ...over,
});
const outlet = { id: 'grp_outlet', handle: 'outlet', name: 'Outlet', role: null };
const withTree = detail({ group: { ...detail().group, parent_id: finance.id }, parent: { ...finance, role: null }, subgroups: [outlet], subgroup_audience: [{ user_id: 'u_eve', username: 'eve', name: 'Eve', via: { id: outlet.id, handle: 'outlet', name: 'Outlet' } }] });
type Call = { url: string; method: string; body: unknown };
function answer(routes: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return routes(call);
  }));
  return calls;
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('lists direct members, and apart from them the people who receive the group\'s files through a subgroup', () => {
  answer(() => Response.json({ members: [] }));
  render(() => <GroupManagement detail={withTree} refresh={() => {}} />);
  const people = screen.getByRole('region', { name: 'Group people' });
  expect(people).toHaveTextContent('Membership is direct');
  const audience = within(people).getByRole('region', { name: 'Receives shared files through a subgroup' });
  expect(within(audience).getByRole('link', { name: 'Eve' })).toHaveAttribute('href', '/@eve');
  expect(audience).toHaveTextContent('via Outlet');
  expect(audience).toHaveTextContent('not members of Retail and cannot act as it');
  // Eve is not in the members list, and has no role control there.
  expect(screen.queryByRole('button', { name: 'Role for Eve' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Role for Alice' })).toBeInTheDocument();
});

it('a group with no subgroups shows no subgroup audience', () => {
  answer(() => Response.json({ members: [] }));
  render(() => <GroupManagement detail={detail()} refresh={() => {}} />);
  expect(screen.queryByRole('region', { name: 'Receives shared files through a subgroup' })).not.toBeInTheDocument();
});

it('says what the group belongs to and what belongs to it, linking only groups the reader is a member of', () => {
  render(() => <GroupTreeSummary detail={withTree} />);
  expect(screen.getByText(/Subgroup of/)).toHaveTextContent('Subgroup of Finance. Files shared with Finance also reach this group’s members.');
  expect(screen.queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument();
  expect(screen.getByText(/Subgroups:/)).toHaveTextContent('Subgroups: Outlet. Files shared with Retail also reach their members.');
  cleanup();
  render(() => <GroupTreeSummary detail={detail({ parent: finance })} />);
  expect(screen.getByRole('link', { name: 'Finance' })).toHaveAttribute('href', '/@finance');
});

it('an editor creates a subgroup beneath this group', async () => {
  const calls = answer(() => Response.json({ id: 'grp_web', handle: 'web_team', name: 'Web', description: '', role: 'editor', parent_id: 'grp_retail' }, { status: 201 }));
  const refresh = vi.fn();
  render(() => <GroupTreePanel detail={detail()} refresh={refresh} />);
  expect(screen.getByRole('region', { name: 'Group tree' })).toHaveTextContent('None: Retail is a top-level group.');
  fireEvent.input(screen.getByRole('textbox', { name: 'Subgroup name' }), { target: { value: 'Web' } });
  fireEvent.input(screen.getByRole('textbox', { name: 'Subgroup handle' }), { target: { value: 'web_team' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create subgroup' }));
  expect(await screen.findByText('Web is now a subgroup of Retail. You are its first editor.')).toBeInTheDocument();
  expect(calls).toEqual([{ url: '/api/groups', method: 'POST', body: { name: 'Web', handle: 'web_team', parent_id: 'grp_retail' } }]);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it('a taken handle is refused in plain words and nothing refreshes', async () => {
  answer(() => Response.json({ error: 'handle_taken' }, { status: 409 }));
  const refresh = vi.fn();
  render(() => <GroupTreePanel detail={detail()} refresh={refresh} />);
  fireEvent.input(screen.getByRole('textbox', { name: 'Subgroup name' }), { target: { value: 'Web' } });
  fireEvent.input(screen.getByRole('textbox', { name: 'Subgroup handle' }), { target: { value: 'taken' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create subgroup' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('That handle is already taken. Choose another.');
  expect(refresh).not.toHaveBeenCalled();
});

it('moves the group under a group the editor edits, naming the parent it loaded, after saying what the move changes', async () => {
  const calls = answer((call) => call.url === '/api/groups' ? Response.json({ groups: [
    { ...finance, description: '', parent_id: null },
    { ...retail, description: '', parent_id: 'grp_finance' },
    { id: 'grp_outlet', handle: 'outlet', name: 'Outlet', description: '', role: 'editor', parent_id: 'grp_retail' },
    { id: 'grp_ops', handle: 'ops', name: 'Operations', description: '', role: 'editor', parent_id: null },
    { id: 'grp_read', handle: 'read', name: 'Readers', description: '', role: 'viewer', parent_id: null },
  ] }) : Response.json({ changed: true, parent_id: 'grp_ops', hierarchy_revision: 9 }));
  const refresh = vi.fn();
  render(() => <GroupTreePanel detail={detail({ group: { ...detail().group, parent_id: finance.id }, parent: finance })} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move group' }));
  const dialog = await screen.findByRole('dialog', { name: 'Move Retail' });
  expect(dialog).toHaveTextContent('Only someone who is an editor of Retail, of its current parent and of the new parent can move it.');
  const parent = within(dialog).getByRole('button', { name: 'New parent group' });
  await waitFor(() => expect(parent).not.toBeDisabled());
  fireEvent.click(parent);
  // Only groups this account edits, never Retail itself or anything below it.
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual(['No parent (a top-level group)', 'Finance', 'Operations']);
  fireEvent.click(screen.getByRole('option', { name: 'Operations' }));
  expect(dialog).toHaveTextContent('Members of Retail and of its subgroups will receive files shared with Operations. They do not become members of Operations.');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Move group' }));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  expect(calls.at(-1)).toEqual({ url: '/api/groups/grp_retail/parent', method: 'PUT', body: { parent_id: 'grp_ops', from_parent_id: 'grp_finance' } });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it.each([
  ['forbidden', 403, 'Only someone who is an editor of this group, of its current parent and of the new parent can move it.'],
  ['parent_changed', 409, 'This group’s parent changed since the page loaded. Reload the page and try again.'],
  ['already_has_parent', 409, 'This group already has a parent. Reload the page, then move it from its current parent.'],
  ['hierarchy_cycle', 409, 'A group cannot move under itself or one of its own subgroups.'],
])('a refused move (%s) stays open with the reason in plain words', async (code, status, words) => {
  answer((call) => call.url === '/api/groups' ? Response.json({ groups: [{ id: 'grp_ops', handle: 'ops', name: 'Operations', description: '', role: 'editor', parent_id: null }] }) : Response.json({ error: code }, { status }));
  const refresh = vi.fn();
  render(() => <GroupTreePanel detail={detail()} refresh={refresh} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move group' }));
  const dialog = await screen.findByRole('dialog', { name: 'Move Retail' });
  const parent = within(dialog).getByRole('button', { name: 'New parent group' });
  await waitFor(() => expect(parent).not.toBeDisabled());
  fireEvent.click(parent);
  fireEvent.click(screen.getByRole('option', { name: 'Operations' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Move group' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(words);
  expect(refresh).not.toHaveBeenCalled();
});

it('moving to the top level says whose files stop arriving', async () => {
  answer(() => Response.json({ groups: [] }));
  render(() => <GroupTreePanel detail={detail({ parent: finance })} refresh={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move group' }));
  const dialog = await screen.findByRole('dialog', { name: 'Move Retail' });
  const parent = within(dialog).getByRole('button', { name: 'New parent group' });
  await waitFor(() => expect(parent).not.toBeDisabled());
  fireEvent.click(parent);
  fireEvent.click(screen.getByRole('option', { name: 'No parent (a top-level group)' }));
  expect(dialog).toHaveTextContent('Retail becomes a top-level group. Its members, and its subgroups’ members, stop receiving files shared with Finance.');
});

it('a viewer sees the tree and the rule, with no controls to change it', () => {
  answer(() => Response.json({}));
  render(() => <GroupTreePanel detail={{ ...withTree, group: { ...withTree.group, role: 'viewer' } }} refresh={() => {}} />);
  const panel = screen.getByRole('region', { name: 'Group tree' });
  expect(panel).toHaveTextContent('Finance');
  expect(panel).toHaveTextContent('Outlet');
  expect(panel).toHaveTextContent('A group with subgroups cannot be deleted until they are moved or deleted.');
  expect(screen.queryByRole('button', { name: 'Move group' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Create subgroup' })).not.toBeInTheDocument();
  expect(fetch).not.toHaveBeenCalled();
});
