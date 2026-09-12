/**
 * The dataset editor's CONNECTION seam: proving a PostgreSQL destination,
 * where its credential may travel, and what the page does before a session
 * has resolved. Discovery results and failures are reported beside the action
 * that caused them, never in the page-level error slot.
 *
 * The two cases that turn `state.viewerSession` down are here on purpose: if
 * the `@/web/session` mock below ever stopped installing, they fail first.
 */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { change, click, connection, discover, editor, installDatasetFetch, reply, state, tables } from '@/test/helpers/dataset-catalog';

vi.mock('@/web/session', () => ({ useSession: () => ({ session: state.viewerSession }) }));
beforeEach(installDatasetFetch);
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('dataset editor — connection and discovery', () => {
  it('shows discovery progress and success beside the connection action, clearing stale success when edited', async () => {
    let finish!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { finish = resolve; });
    state.discoveryReply = () => pending;
    editor(true); await screen.findByLabelText('Password status'); click('Test and discover');
    const panel = within(screen.getByLabelText('Dataset connection'));
    expect(panel.getByRole('status')).toHaveTextContent(/connecting/i);
    expect(panel.getByLabelText('Test and discover')).toBeDisabled();
    finish(new Response(JSON.stringify({ tables })));
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent(/connected.*2 tables/i));
    expect(panel.getByLabelText('Test and discover').compareDocumentPosition(panel.getByRole('status')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    change('Host', 'another.example.com');
    expect(panel.queryByRole('status')).not.toBeInTheDocument();
  });

  it('shows discovery failure beside the connection action and replaces it on retry', async () => {
    state.discoveryReply = () => reply({ error: 'Could not connect to PostgreSQL.' }, 400);
    editor(true); await screen.findByLabelText('Password status'); click('Test and discover');
    const panel = within(screen.getByLabelText('Dataset connection'));
    await waitFor(() => expect(panel.getByRole('alert')).toHaveTextContent('Could not connect'));
    expect(panel.getByLabelText('Test and discover')).toBeEnabled();
    state.discoveryReply = undefined; click('Test and discover');
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent('Connected'));
    expect(panel.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['validation', 'secret', 'network'] as const)('shows %s discovery failures only below the connection action', async failure => {
    editor(); click('PostgreSQL');
    if (failure !== 'validation') {
      for (const [label,value] of [['Host',connection.host],['Database','analytics'],['Username','reader'],['Password','private-password']]) change(label,value);
    }
    if (failure === 'secret') state.secretReply=()=>reply({error:'Could not store credentials'},503);
    if (failure === 'network') state.discoveryReply=()=>Promise.reject(new Error('Network unavailable'));
    click('Test and discover');
    const panel=within(screen.getByLabelText('Dataset connection'));
    const alert=await panel.findByRole('alert');
    expect(alert).toHaveAttribute('aria-label','Dataset error');
    expect(screen.getAllByLabelText('Dataset error')).toHaveLength(1);
    expect(panel.getByLabelText('Test and discover').compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alert).toHaveTextContent(failure === 'validation' ? /host.*port.*database.*username/i : failure === 'secret' ? 'Could not store credentials' : 'Network unavailable');
  });

  it('explains an empty discovery result and clears its success when replacing the password', async () => {
    state.discoveryTables=[]; editor(true); await screen.findByLabelText('Password status'); click('Test and discover');
    const panel=within(screen.getByLabelText('Dataset connection'));
    await waitFor(() => expect(panel.getByRole('status')).toHaveTextContent(/connected.*no tables/i));
    expect(screen.getAllByLabelText('Dataset notice')).toHaveLength(1);
    click('Replace password'); expect(panel.queryByRole('status')).not.toBeInTheDocument();
  });

  it('uses a neutral create label while the session is loading and never fetches connections', async () => {
    state.viewerSession = null; editor();
    expect(await screen.findByLabelText('Save dataset')).toHaveTextContent(/^Create dataset$/);
    expect(state.calls.some(c => c.url.includes('/connections'))).toBe(false);
  });

  it('sends signed-out creators to login', async () => {
    state.viewerSession = { user: null }; editor(); await screen.findByLabelText('Dataset login');
  });

  it('sends passwords only to the write-only secrets endpoint and discovers using the reference', async () => {
    editor(); await discover();
    const { passwordSecretId: _, ...destination } = connection;
    expect(state.calls.find(c => c.url === '/api/my/secrets')?.body).toEqual({ value: 'private-password', connection: destination });
    expect(state.calls.find(c => c.url.endsWith('/discover'))?.body).toEqual({ connection: { ...destination, passwordSecretId: 'secret-new' } });
    expect(state.calls.filter(c => c.url !== '/api/my/secrets').every(c => !JSON.stringify(c).includes('private-password'))).toBe(true);
    expect(screen.getByLabelText('Password status')).toHaveTextContent('Configured');
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
    click('Replace password'); expect(screen.getByLabelText('Password')).toHaveValue('');
    expect(screen.queryByLabelText('Connection name')).not.toBeInTheDocument();
  });

  it('requires a replacement credential when the connection destination changes', async () => {
    editor(true); await screen.findByLabelText('Password status'); change('Host', 'other.example.com');
    expect(screen.getByLabelText('Password')).toHaveValue(''); click('Test and discover');
    await waitFor(() => expect(screen.getByLabelText('Dataset error')).toHaveTextContent(/password/i));
    expect(state.calls.some(c => c.url.endsWith('/discover'))).toBe(false);
  });
});
