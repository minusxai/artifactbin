/**
 * THE EDIT PANEL: one right panel for the whole edit session on a wide window,
 * bottom sheets below the breakpoint. What must hold is that nothing inside the
 * session changes the width the page reserves — only the collapse button — and
 * that a selection fills the panel without taking it over.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, act, within, cleanup } from '@testing-library/react';
import { STORY_SELECTION_MESSAGE } from '@/lib/story-runtime/contract';
import { EDIT_PANEL_BREAKPOINT } from '@/lib/story/edit-bar';
import type { ReactNode } from 'react';

// Sheets live in the trusted overlay's shadow root; these cases are about what
// opens, not where the top layer paints it (artifact-trusted-portals, the gates).
vi.mock(import('@/components/TrustedUi'), async (importOriginal) => ({
  ...await importOriginal(),
  TrustedUi: ({ children }: { children: ReactNode }) => children,
  useTrustedPortalContainer: () => undefined,
}));

import { installEditorFrame, teardownEditorFrame, mount, fromFrame, selection, editorElement } from '@/test/helpers/in-place-editor';

const chart = () => selection({ kind: 'embed', tag: 'Question', path: '0.2', rect: { x: 10, y: 400, width: 300, height: 200 } });
const setWidth = (width: number) => Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
const choosePanel = (value: string) => {
  const picker = screen.queryByRole('combobox', { name: 'Editor panel' });
  if (picker) fireEvent.change(picker, { target: { value: value.toLowerCase() } });
  else fireEvent.click(screen.getByRole('tab', { name: new RegExp(`^${value}$`, 'i') }));
};
const activePanel = () => screen.getAllByRole('tab', { selected: true }).at(-1)!.textContent!.toLowerCase();

beforeEach(() => {
  installEditorFrame();
  try { window.localStorage.clear(); } catch { /* storage may be unavailable */ }
  setWidth(1440);
});
afterEach(() => {
  cleanup();
  teardownEditorFrame();
  setWidth(1024);
});

describe('the edit panel on a wide window', () => {
  it('groups inspector tools under a remembered Inspector tab and supports keyboard navigation', () => {
    mount({ onCommentsOpenChange: vi.fn() });
    const groups = screen.getByRole('tablist', { name: 'Editor panels' });
    expect(within(groups).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Inspector', 'Files', 'Sharing']);
    expect(screen.queryByRole('combobox', { name: 'Editor panel' })).toBeNull();
    choosePanel('History');
    choosePanel('Files');
    expect(screen.queryByRole('tablist', { name: 'Inspector tabs' })).toBeNull();
    expect(screen.getByText('No referenced files.')).toBeTruthy();
    choosePanel('Inspector');
    expect(screen.getByLabelText('Version history')).toBeTruthy();
    expect(activePanel()).toBe('history');
    const inspector = screen.getByRole('tab', { name: 'Inspector' });
    fireEvent.keyDown(inspector, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: 'Files' })).toHaveFocus();
    expect(screen.getByText('No referenced files.')).toBeTruthy();
  });

  it('is open from entry, and nothing in the session changes the width it asks for', async () => {
    const widths: number[] = [];
    const onCommentsOpenChange = vi.fn();
    const view = mount({ onRightInsetChange: (px) => widths.push(px), onCommentsOpenChange });
    expect(screen.getByLabelText('Edit panel')).toBeTruthy();
    expect(screen.getByText('Select a chart, image or block to see its settings.')).toBeTruthy();

    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
    expect(within(screen.getByLabelText('Edit panel')).getByLabelText('Chart inspector')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close chart inspector'));
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: null });
    choosePanel('History');
    choosePanel('Comments');
    expect(onCommentsOpenChange).toHaveBeenLastCalledWith(true);
    view.rerender(editorElement({ onRightInsetChange: (px) => widths.push(px), onCommentsOpenChange, commentsOpen: true }));
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
    fireEvent.click(screen.getByLabelText('Edit the source'));
    fireEvent.click(screen.getByLabelText('Edit on the page'));
    choosePanel('Files');
    expect(screen.getByLabelText('Edit panel')).toContainElement(screen.getByLabelText('Files'));
    fireEvent.click(screen.getByLabelText('Show data'));
    expect(screen.getByLabelText('Data')).toHaveStyle({ left: '0px', right: '320px' });
    fireEvent.click(screen.getByLabelText('Edit on the page'));

    // Every value ever reported, not just the last: a 320 → 0 → 320 flicker
    // inside one act is exactly the jump this panel exists to remove.
    expect(new Set(widths)).toEqual(new Set([320]));
  });

  it('follows the selection on the Selection tab; elsewhere it only marks the tab', async () => {
    mount();
    choosePanel('History');
    expect(screen.getByLabelText('Version history')).toBeTruthy();

    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
    expect(activePanel()).toBe('history');
    expect(screen.queryByLabelText('Chart inspector')).toBeNull();
    expect(screen.getByLabelText('New selection available')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Edit chart' }));
    expect(activePanel()).toBe('selection');
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
    expect(screen.queryByLabelText('New selection available')).toBeNull();
  });

  it('switches to Selection on a double-click inside the selected chart', async () => {
    const page = document.createElement('div');
    page.setAttribute('aria-label', 'Artifact viewport');
    const figure = document.createElement('figure');
    page.appendChild(figure);
    document.body.appendChild(page);
    try {
      mount();
      choosePanel('History');
      await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
      // Outside the chart's rect: nothing.
      fireEvent.dblClick(figure, { clientX: 500, clientY: 100 });
      expect(activePanel()).toBe('history');
      fireEvent.dblClick(figure, { clientX: 50, clientY: 450 });
      expect(activePanel()).toBe('selection');
      expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
    } finally {
      page.remove();
    }
  });

  it('hosts the comments rail in its Comments tab and follows the rail both ways', async () => {
    const hosts: Array<HTMLElement | null> = [];
    const onCommentsOpenChange = vi.fn();
    const props = { onCommentsOpenChange, onCommentsHost: (el: HTMLElement | null) => hosts.push(el) };
    const view = mount(props);
    expect(hosts.filter(Boolean)).toHaveLength(0);

    // Opened from outside the panel (a pin, the reader bar): the tab follows.
    view.rerender(editorElement({ ...props, commentsOpen: true }));
    expect(activePanel()).toBe('comments');
    expect(within(screen.getByLabelText('Edit panel')).getByRole('region', { name: 'Comments' })).toContainElement(hosts.at(-1)!);

    // Leaving the tab closes the rail, and the panel stays where it was sent.
    choosePanel('History');
    expect(onCommentsOpenChange).toHaveBeenLastCalledWith(false);
    view.rerender(editorElement({ ...props, commentsOpen: false }));
    expect(activePanel()).toBe('history');

    // The rail closed from its own header hands the panel back to Selection.
    choosePanel('Comments');
    view.rerender(editorElement({ ...props, commentsOpen: true }));
    view.rerender(editorElement({ ...props, commentsOpen: false }));
    expect(activePanel()).toBe('selection');
  });

  it('offers no Comments tab to someone who may not comment', () => {
    mount();
    expect(screen.queryByRole('tab', { name: 'Comments' })).toBeNull();
  });

  it('collapses from its button, remembers it, and a selection alone never expands it', async () => {
    const widths: number[] = [];
    const first = mount({ onRightInsetChange: (px) => widths.push(px) });
    fireEvent.click(screen.getByLabelText('Collapse panel'));
    expect(widths.at(-1)).toBe(44);
    expect(window.localStorage.getItem('mx:edit-panel-collapsed')).toBe('1');
    first.unmount();

    mount({ onRightInsetChange: (px) => widths.push(px) });
    expect(screen.getByLabelText('Expand panel')).toBeTruthy();
    widths.length = 0;
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: null });
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
    expect(screen.getByLabelText('Expand panel')).toBeTruthy();
    expect(widths).toEqual([]);

    fireEvent.click(screen.getByLabelText('Expand panel'));
    expect(widths.at(-1)).toBe(320);
    expect(window.localStorage.getItem('mx:edit-panel-collapsed')).toBeNull();
  });

  describe('explicit requests expand a collapsed panel and clear the saved choice', () => {
    const collapsedMount = (over: Parameters<typeof mount>[0] = {}) => {
      window.localStorage.setItem('mx:edit-panel-collapsed', '1');
      const widths: number[] = [];
      const view = mount({ onRightInsetChange: (px) => widths.push(px), ...over });
      expect(screen.getByLabelText('Expand panel')).toBeTruthy();
      return { view, widths };
    };
    const expandedOn = (name: string, widths: number[]) => {
      expect(screen.queryByLabelText('Expand panel')).toBeNull();
      expect(activePanel()).toBe(name.toLowerCase());
      expect(widths.at(-1)).toBe(320);
      expect(window.localStorage.getItem('mx:edit-panel-collapsed')).toBeNull();
    };

    it('a strip tab icon', () => {
      const { widths } = collapsedMount();
      fireEvent.click(screen.getByRole('tab', { name: 'History' }));
      expandedOn('History', widths);
      expect(screen.getByLabelText('Version history')).toBeTruthy();
    });

    it('Edit chart', async () => {
      const { widths } = collapsedMount();
      await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
      fireEvent.click(screen.getByRole('button', { name: 'Edit chart' }));
      expandedOn('Selection', widths);
      expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
    });

    it('a double-click on the selected chart', async () => {
      const page = document.createElement('div');
      page.setAttribute('aria-label', 'Artifact viewport');
      document.body.appendChild(page);
      try {
        const { widths } = collapsedMount();
        await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
        fireEvent.dblClick(page, { clientX: 50, clientY: 450 });
        expandedOn('Selection', widths);
      } finally {
        page.remove();
      }
    });

    it('comments opened from elsewhere — never open with nothing visible', () => {
      const hosts: Array<HTMLElement | null> = [];
      const props = { onCommentsOpenChange: vi.fn(), onCommentsHost: (el: HTMLElement | null) => hosts.push(el) };
      const { view, widths } = collapsedMount(props);
      view.rerender(editorElement({ ...props, onRightInsetChange: (px) => widths.push(px), commentsOpen: true }));
      expandedOn('Comments', widths);
      expect(hosts.at(-1)).toBeInstanceOf(HTMLElement);
    });

    it('comments already open when the session starts', () => {
      window.localStorage.setItem('mx:edit-panel-collapsed', '1');
      mount({ onCommentsOpenChange: vi.fn(), commentsOpen: true });
      expect(screen.queryByLabelText('Expand panel')).toBeNull();
      expect(activePanel()).toBe('comments');
    });
  });

  it('survives storage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    mount();
    fireEvent.click(screen.getByLabelText('Collapse panel'));
    expect(screen.getByLabelText('Expand panel')).toBeTruthy();
  });

  it('puts the app / code switch in the editor toolbar', () => {
    mount();
    const toolbar = screen.getByLabelText('Editor toolbar');
    expect(toolbar).toContainElement(screen.getByLabelText('Edit on the page'));
    expect(toolbar).toContainElement(screen.getByLabelText('Edit the source'));
    expect(screen.queryByLabelText('Artifact parts')).toBeNull();
  });
});

describe('below the panel breakpoint', () => {
  beforeEach(() => setWidth(EDIT_PANEL_BREAKPOINT - 160));

  it('reserves nothing and draws no side panel', () => {
    const widths: number[] = [];
    mount({ onRightInsetChange: (px) => widths.push(px) });
    expect(screen.queryByLabelText('Edit panel')).toBeNull();
    expect(new Set(widths)).toEqual(new Set([0]));
  });

  it('a tap only selects; Edit chart opens the sheet and scrolls the chart above it', async () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
    expect(screen.queryByRole('dialog', { name: 'Selection settings' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Edit chart' }));
    const sheet = screen.getByRole('dialog', { name: 'Selection settings' });
    expect(within(sheet).getByLabelText('Chart inspector')).toBeTruthy();
    // The chart's top lands just under the bars (44 + 88 + 8).
    expect(scrollBy).toHaveBeenCalledWith({ top: 400 - 140, behavior: 'smooth' });

    fireEvent.click(within(sheet).getByLabelText('Close selection settings'));
    expect(screen.queryByRole('dialog', { name: 'Selection settings' })).toBeNull();
    expect(scrollBy).toHaveBeenCalledTimes(1);
  });

  it('opens the sheet on a double-tap inside the selected chart', async () => {
    vi.stubGlobal('scrollBy', vi.fn());
    const page = document.createElement('div');
    page.setAttribute('aria-label', 'Artifact viewport');
    document.body.appendChild(page);
    try {
      mount();
      await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
      const tap = (timeStamp: number) => act(() => {
        const event = new MouseEvent('pointerup', { bubbles: true, clientX: 60, clientY: 450 });
        Object.defineProperties(event, { pointerType: { value: 'touch' }, timeStamp: { value: timeStamp } });
        page.dispatchEvent(event);
      });
      tap(1000);
      expect(screen.queryByRole('dialog', { name: 'Selection settings' })).toBeNull();
      tap(1200);
      expect(screen.getByRole('dialog', { name: 'Selection settings' })).toBeTruthy();
    } finally {
      page.remove();
    }
  });

  it('offers ONE selection button, named for what is selected, so a phone row has no duplicate', async () => {
    vi.stubGlobal('scrollBy', vi.fn());
    setWidth(390);
    mount();
    expect(screen.getByRole('button', { name: 'Show selection settings' })).toBeTruthy();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: chart() });
    expect(screen.getAllByRole('button', { name: 'Edit chart' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Show selection settings' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit chart' }));
    expect(screen.getByRole('dialog', { name: 'Selection settings' })).toBeTruthy();
  });

  it('draws the app / code switch icon-only on a phone, keeping its names', () => {
    setWidth(390);
    mount();
    for (const name of ['Edit on the page', 'Edit the source']) {
      const button = screen.getByRole('button', { name });
      const label = [...button.querySelectorAll('span')].find((el) => el.textContent);
      expect(label?.className).toMatch(/\bhidden\b.*\bsm:inline\b/);
    }
  });

  it('opens files on a phone without replacing the workspace and keeps appearance in the toolbar', () => {
    setWidth(390);
    mount();
    fireEvent.click(screen.getByLabelText('Edit the source'));
    choosePanel('Files');
    expect(screen.getByRole('dialog', { name: 'Files' })).toBeTruthy();
    expect(screen.getByLabelText('Markup source')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close Files'));
    expect(within(screen.getByLabelText('Editor toolbar')).getByLabelText('Color mode')).toBeTruthy();
  });

  it('opens history and comments from the bar, one sheet at a time', () => {
    const onCommentsOpenChange = vi.fn();
    mount({ onCommentsOpenChange });
    choosePanel('History');
    expect(screen.getByRole('dialog', { name: 'Version history' })).toBeTruthy();
    choosePanel('Comments');
    expect(onCommentsOpenChange).toHaveBeenLastCalledWith(true);
    expect(screen.queryByRole('dialog', { name: 'Version history' })).toBeNull();
  });
});
