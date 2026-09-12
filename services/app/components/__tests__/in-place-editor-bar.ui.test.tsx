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

  it('opens version history', () => {
    mount();
    fireEvent.click(screen.getByLabelText('Open version history'));
    expect(screen.getByLabelText('Open version history').getAttribute('aria-expanded')).toBe('true');
  });
});

describe('leaving', () => {
  it('keeps the single done action in the contextual editor toolbar', () => {
    const onDone = vi.fn();
    mount({ onDone });
    fireEvent.click(screen.getByLabelText('Exit edit mode'));
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
