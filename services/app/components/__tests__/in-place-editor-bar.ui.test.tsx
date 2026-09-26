/**
 * THE EDITOR BAR and LEAVING: the document-wide controls (template name,
 * title, colour mode, code mode, version history) and every exit — the
 * published drain, a hidden tab, and telling the document to stop being
 * editable. The history drawer's own rendering is here too: it is the surface
 * the bar's "opens version history" case stops at.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import VersionHistory from '../VersionHistory';
import {
  STORY_DOCUMENT_MESSAGE,
  STORY_SPOTLIGHT_MESSAGE,
} from '@/lib/story-runtime/contract';
import {
  type EditorArt,
  art,
  env,
  flushNow,
  installEditorFrame,
  lastQueued,
  mount,
  sentToFrame,
  teardownEditorFrame,
} from '@/test/helpers/in-place-editor';

const choosePanel = (value: string) => fireEvent.change(screen.getByRole('combobox', { name: 'Editor panel' }), { target: { value } });

beforeEach(installEditorFrame);
afterEach(teardownEditorFrame);

describe('the editor bar', () => {
  it('names the template when the document has one, and not when it does not', () => {
    const { unmount } = mount();
    expect(screen.queryByText(/template/i)).toBeNull();
    unmount();
    mount({ art: { ...art, template: 'briefing' } as EditorArt });
    choosePanel('settings');
    expect(screen.getByText(/briefing/i)).toBeTruthy();
  });

  it('queues a title change', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'renamed' } });
    expect(lastQueued()).toMatchObject({ title: 'renamed' });
  });

  it('switches through sharing without a modal and reports visibility changes to the page', async () => {
    const onSharingChange = vi.fn();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/sharing')
      ? new Response(JSON.stringify({ visibility: 'private', shares: [], canPrivate: true }))
      : originalFetch(input, init)));
    mount({ onSharingChange });
    choosePanel('sharing');
    await waitFor(() => expect(screen.getByLabelText('Make public')).toBeTruthy());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onSharingChange).toHaveBeenCalledWith({ visibility: 'private', hasInvitedUsers: false });
    fireEvent.click(screen.getByLabelText('Edit the source'));
    expect(screen.getByLabelText('Sharing settings')).toBeTruthy();
    expect(screen.getByLabelText('Markup source')).toBeTruthy();
  });

  it('queues a colour-mode pick and tells the document; theme default queues null', () => {
    mount();
    env.posted.length = 0;
    expect(within(screen.getByLabelText('Editor toolbar')).queryByLabelText('Color mode')).toBeNull();
    choosePanel('settings');
    fireEvent.click(screen.getByLabelText('Color mode'));
    fireEvent.click(screen.getByLabelText('Color mode dark'));
    expect(lastQueued()).toMatchObject({ colorMode: 'dark' });
    expect(sentToFrame(STORY_DOCUMENT_MESSAGE).length).toBeGreaterThan(0);
    // Back to the theme's own default: an explicit CLEAR, not an absence.
    fireEvent.click(screen.getByLabelText('Color mode'));
    fireEvent.click(screen.getByLabelText('Color mode theme default'));
    expect(lastQueued()).toMatchObject({ colorMode: null });
  });

  it('edits the source in code mode through the SAME queue', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Edit the source'));
    fireEvent.change(screen.getByLabelText('Markup source'), { target: { value: '<p>rewritten</p>' } });
    expect(lastQueued()).toMatchObject({ source: '<p>rewritten</p>' });
  });

  it('lists the versions in the edit panel\'s History tab rather than behind a drawer switch', () => {
    mount();
    // A wide window has the panel, so the narrow bar's drawer switch is absent.
    expect(screen.queryByLabelText('Open version history')).toBeNull();
    choosePanel('history');
    expect(within(screen.getByLabelText('Edit panel')).getByLabelText('Version history')).toBeTruthy();
  });
});

describe('leaving', () => {
  it('offers the way out in the toolbar, and it leaves once', () => {
    const onDone = vi.fn();
    mount({ onDone });
    // The left rail and its second door are gone; the toolbar's is the one.
    const bar = screen.getByLabelText('Exit edit mode');
    expect(screen.getByLabelText('Document actions')).toContainElement(bar);
    expect(screen.queryByLabelText('Done editing')).toBeNull();
    fireEvent.click(bar);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('publishes its drain for the page to call — back button, closing tab', async () => {
    const flushRef = { current: null as null | (() => Promise<void>) };
    mount({ flushRef });
    expect(typeof flushRef.current).toBe('function');
    await flushRef.current!();
    expect(flushNow).toHaveBeenCalled();
  });

  it('drains when the tab is hidden', async () => {
    mount();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(flushNow).toHaveBeenCalled());
  });

  it('tells the document to stop being editable', async () => {
    const { unmount } = mount();
    env.posted.length = 0;
    unmount();
    expect(env.posted.some((m) => m.type === 'mx:edit-mode' && m.on === false)).toBe(true);
  });
});

/**
 * The version-history drawer names WHO made a version when the row knows —
 * a collaborator's edits are the reason history can say so at all — and
 * says nothing (never an email, never a placeholder) when it does not.
 */
const version = (n: number, by: string | null) => ({ version: n, title: null, description: null, format: 'markup', by, created_at: '2026-08-01T00:00:00.000Z' });

describe('VersionHistory', () => {
  it('shows the author handle on attributed rows and nothing on the rest', () => {
    render(
      <VersionHistory
        versions={[version(2, 'bob'), version(1, null)]}
        currentVersion={3}
        previewing={null}
        onPreview={vi.fn()}
        onRestore={vi.fn()}
        onBackToCurrent={vi.fn()}
        onClose={vi.fn()}
        busy={false}
      />,
    );
    expect(screen.getByLabelText('Version 2 by bob')).toHaveTextContent('@bob');
    expect(screen.queryByLabelText(/Version 1 by/)).toBeNull();
    expect(screen.getByLabelText('Preview version 1')).not.toHaveTextContent('@');
  });
});

/**
 * The query notebook: every <Query> the document declares, as cells in a view
 * over the document (the toolbar's app / code / data switch). The bar offers it only when there is something to show, and a
 * cell's edit is a structural edit like any other — it rewrites the
 * declaration and goes out through the same queue.
 */
describe('the query notebook', () => {
  const QUERY_SOURCE =
    '<Helmet><Query name="sales" source="ref:ds1234">{`select 1 as x`}</Query></Helmet>'
    + '<div data-design="tw" className="p-4"><Question data="$sales" /></div>';
  const withQuery = () => mount({ art: { ...art, markup: QUERY_SOURCE } as EditorArt });

  it('offers data settings even when the document declares no queries', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Show data'));
    expect(screen.getByLabelText('Data')).toBeTruthy();
    expect(screen.getByText('No queries in this artifact.')).toBeTruthy();
    choosePanel('datasets');
    expect(screen.getByText('No referenced datasets.')).toBeTruthy();
  });

  it('keeps Files open independently of the workspace without opening a dialog', () => {
    mount();
    choosePanel('files');
    expect(screen.getByLabelText('Files')).toBeTruthy();
    expect(screen.getByText('No referenced files.')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Edit the source'));
    expect(screen.getByLabelText('Files')).toBeTruthy();
    expect(screen.getByLabelText('Markup source')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Show data'));
    expect(screen.getByLabelText('Files')).toBeTruthy();
    expect(screen.getByLabelText('Data')).toBeTruthy();
    expect(within(screen.getByLabelText('Editor view')).getAllByRole('button')).toHaveLength(3);
  });

  it('opens data as a VIEW with each query as a cell, and the view switch leaves it', () => {
    withQuery();
    fireEvent.click(screen.getByLabelText('Show data'));
    expect(screen.getByLabelText('Data')).toBeTruthy();
    expect((screen.getByLabelText('Query $sales SQL') as HTMLTextAreaElement).value).toBe('select 1 as x');
    // app, code and data are three views of one document: a view does not close
    // itself, the switch picks another — so there is no close button to press.
    expect(screen.queryByLabelText('Close queries')).toBeNull();
    fireEvent.click(screen.getByLabelText('Edit on the page'));
    expect(screen.queryByLabelText('Data')).toBeNull();
  });

  it('an edited cell rewrites that declaration through the SAME queue', () => {
    withQuery();
    fireEvent.click(screen.getByLabelText('Show data'));
    const field = screen.getByLabelText('Query $sales SQL');
    fireEvent.change(field, { target: { value: 'select 2 as x' } });
    fireEvent.blur(field);
    expect(lastQueued()?.source).toContain('<Query name="sales" source="ref:ds1234">{`select 2 as x`}</Query>');
    expect(lastQueued()!.source).toContain('<Question data="$sales" />');
  });

  it('asks the document to spotlight what a query powers while its cell has focus', () => {
    withQuery();
    fireEvent.click(screen.getByLabelText('Show data'));
    const field = screen.getByLabelText('Query $sales SQL');
    fireEvent.focus(field);
    expect(sentToFrame(STORY_SPOTLIGHT_MESSAGE).at(-1)).toMatchObject({ paths: ['0.0'] });
    fireEvent.blur(field);
    expect(sentToFrame(STORY_SPOTLIGHT_MESSAGE).at(-1)).toMatchObject({ paths: [] });
  });
});
