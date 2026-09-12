/**
 * THE CHROME THE SELECTION DRIVES: which inspector or toolbar a selection
 * opens, what it writes back, and what happens to an open inspector when a
 * write from elsewhere lands under it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import {
  STORY_EDIT_READY_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_SELECT_MESSAGE,
} from '@/lib/story-runtime/contract';
import {
  editorElement,
  env,
  fromFrame,
  installEditorFrame,
  lastQueued,
  live,
  mount,
  queue,
  selection,
  sentToFrame,
  teardownEditorFrame,
} from '@/test/helpers/in-place-editor';

beforeEach(installEditorFrame);
afterEach(teardownEditorFrame);

describe('the chrome the selection drives', () => {
  it('restores a view-mode text selection after the edit runtime is ready', async () => {
    mount({ initialSelectionPath: '0.1' });
    env.posted.length = 0;
    await fromFrame({ type: STORY_EDIT_READY_MESSAGE });
    await waitFor(() => expect(sentToFrame(STORY_SELECT_MESSAGE).at(-1)).toMatchObject({ path: '0.1' }));
  });

  it('opens the chart inspector for a selected Question, and writes its edits back', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
  });

  it('shuts the inspector on `close` WITHOUT waiting for the document to agree', () => {
    // Deselecting is not something the document has to describe back. Routing
    // it through the frame made `close` land a message round-trip later — the
    // panel visibly outlived the click, and a gate that asserted right after it
    // saw the inspector still open.
    mount();
    void fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close chart inspector'));
    expect(screen.queryByLabelText('Chart inspector')).toBeNull();
    // The document is still told, so it drops its own selected stamp.
    expect(sentToFrame(STORY_SELECT_MESSAGE).at(-1)).toMatchObject({ path: null });
  });

  it('DROPS the chart selection when a write from elsewhere lands', async () => {
    /*
     * AST paths are positional. An agent inserting a node before the selected
     * chart shifts it, and the inspector would go on editing whatever now sits
     * at that path — plausibly a different <Question>, which no tag guard
     * downstream would question. So an adopted document closes the inspector.
     */
    const view = mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();

    live.remote = { format: 'markup', source: '<div id="w"><p id="h">x</p></div>', editId: 'e2', version: 5 };
    live.adopted = true;
    await act(async () => { view.rerender(editorElement()); });
    expect(screen.queryByLabelText('Chart inspector')).toBeNull();
  });

  it('KEEPS it when the same stream delivers nothing to adopt', async () => {
    // Our own echo comes back down the same stream; closing on that would shut
    // the inspector every time the user changed anything in it.
    const view = mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    live.remote = { format: 'markup', source: '<div id="w"><p id="h">x</p></div>', editId: 'e2', version: 5 };
    live.adopted = false;
    await act(async () => { view.rerender(editorElement()); });
    expect(screen.getByLabelText('Chart inspector')).toBeTruthy();
  });

  it('opens the number inspector for a selected Number', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Number', path: '0.3' }) });
    expect(screen.getByLabelText('Number inspector')).toBeTruthy();
  });

  it('shows the full format toolbar for a selected element', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection() });
    expect(screen.getByLabelText('Typography toolbar')).toBeTruthy();
    expect(screen.getByLabelText('Toggle bold')).toBeTruthy();
    expect(screen.getByLabelText('Delete element')).toBeTruthy();
  });

  it('a component gets the toolbar too — name, comment, delete; no format chips', async () => {
    /*
     * Every element is clickable and every click lands somewhere useful
     * (lib/story/selection-toolbar is the one mapping). A component's classes
     * are render output, so no class algebra — but the element's name, the
     * comment door and delete are unconditional. A <GridItem> tile used to
     * select into silence: outline, no controls, nothing to do with it.
     */
    const onComment = vi.fn();
    mount({ onComment });
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection({ kind: 'embed', tag: 'Question', path: '0.2' }) });
    expect(screen.getByLabelText('Typography toolbar')).toBeTruthy();
    expect(screen.getByLabelText('Selection breadcrumb').textContent).toContain('Question');
    expect(screen.getByLabelText('Comment on selection')).toBeTruthy();
    expect(screen.getByLabelText('Delete element')).toBeTruthy();
    expect(screen.queryByLabelText('Toggle bold')).toBeNull();
    expect(screen.queryByLabelText('Align left')).toBeNull();
    expect(screen.queryByLabelText('More formatting controls')).toBeNull();
  });

  it('sends semantic inline formatting to the live editor transaction', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection() });
    env.posted.length = 0;
    fireEvent.click(screen.getByLabelText('Toggle bold'));
    expect(sentToFrame('mx:inline')).toEqual([expect.objectContaining({tag:'strong'})]);
  });

  it('lets the prose engine own block formatting without a duplicate source save', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: { ...selection(), editor: 'prose' } });
    queue.mockClear();
    fireEvent.click(screen.getByLabelText('Increase font size'));
    expect(sentToFrame('mx:apply-format').length).toBeGreaterThan(0);
    expect(queue).not.toHaveBeenCalled();
    const replacement = '<p id="lede" className="lede text-lg">hello</p>';
    await fromFrame({ type: 'mx:flow-edit', path: '0.1', expected: '<p id="lede" className="lede">hello</p>', replacement });
    expect(queue).toHaveBeenCalledTimes(1);
    expect(lastQueued()?.source).toContain(replacement);
    expect(screen.queryByRole('alertdialog', { name: 'Recover uncommitted text' })).toBeNull();
  });

  it('deletes from the toolbar too', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection() });
    fireEvent.click(screen.getByLabelText('Delete element'));
    await waitFor(() => expect(lastQueued()?.source).not.toContain('id="lede"'));
  });
});
