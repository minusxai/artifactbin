/**
 * THE EDITOR BAR and LEAVING: the document-wide controls (template name,
 * title, colour mode, code mode, version history) and every exit — the
 * published drain, a hidden tab, and telling the document to stop being
 * editable. The history drawer's own rendering is here too: it is the surface
 * the bar's "opens version history" case stops at.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

beforeEach(installEditorFrame);
afterEach(teardownEditorFrame);

describe('the editor bar', () => {
  it('names the template when the document has one, and not when it does not', () => {
    const { unmount } = mount();
    expect(screen.queryByText(/template/i)).toBeNull();
    unmount();
    mount({ art: { ...art, template: 'briefing' } as EditorArt });
    expect(screen.getByText(/briefing/i)).toBeTruthy();
  });

  it('queues a title change', () => {
    mount();
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'renamed' } });
    expect(lastQueued()).toMatchObject({ title: 'renamed' });
  });

  it('queues a colour-mode pick and tells the document; theme default queues null', () => {
    mount();
    env.posted.length = 0;
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

  it('lists the versions in the rail rather than behind a switch', () => {
    mount();
    // "which version am I looking at" is answered without being asked, so
    // there is no longer an expand control to press.
    expect(screen.queryByLabelText('Open version history')).toBeNull();
    expect(screen.getByLabelText('Version history')).toBeTruthy();
  });
});

describe('leaving', () => {
  it('offers the way out twice — in the toolbar and at the foot of the rail — and each leaves once', () => {
    const onDone = vi.fn();
    mount({ onDone });
    // Two doors, two NAMES: sharing one would make every locator that says
    // "Exit edit mode" match both (the browser gates do).
    const bar = screen.getByLabelText('Exit edit mode');
    const rail = screen.getByLabelText('Done editing');
    expect(screen.getByLabelText('Document actions')).toContainElement(bar);
    expect(screen.getByLabelText('Artifact parts')).toContainElement(rail);
    fireEvent.click(rail);
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
 * The query notebook: every <Query> the document declares, in the right rail
 * as cells. The bar offers it only when there is something to show, and a
 * cell's edit is a structural edit like any other — it rewrites the
 * declaration and goes out through the same queue.
 */
describe('the query notebook', () => {
  const QUERY_SOURCE =
    '<Helmet><Query name="sales" source="ref:ds1234">{`select 1 as x`}</Query></Helmet>'
    + '<div data-design="tw" className="p-4"><Question data="$sales" /></div>';
  const withQuery = () => mount({ art: { ...art, markup: QUERY_SOURCE } as EditorArt });

  it('offers the notebook only when the document declares a query', () => {
    mount();
    expect(screen.queryByLabelText('Show data')).toBeNull();
    expect(screen.queryByLabelText('Queries')).toBeNull();
  });

  it('opens data as a VIEW with each query as a cell, and the rail switches away from it', () => {
    withQuery();
    fireEvent.click(screen.getByLabelText('Show data'));
    expect(screen.getByLabelText('Data')).toBeTruthy();
    expect((screen.getByLabelText('Query $sales SQL') as HTMLTextAreaElement).value).toBe('select 1 as x');
    // app, code and data are three views of one document: a view does not close
    // itself, the rail picks another — so there is no close button to press.
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
