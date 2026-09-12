/**
 * WHAT THE DOCUMENT SAYS, and what the editor does with it: a signed text
 * edit composed into the source and persisted, an unsigned one dropped, a
 * delete by key, the draft queries and stylesheet the editor owes a
 * paint-first page, and the recovery dialog for a fragment the engine refused.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import {
  STORY_DOCUMENT_MESSAGE,
  STORY_EDIT_KEY_MESSAGE,
  STORY_SELECTION_MESSAGE,
  STORY_TEXT_EDIT_MESSAGE,
} from '@/lib/story-runtime/contract';
import {
  type EditorArt,
  art,
  env,
  fromFrame,
  installEditorFrame,
  lastQueued,
  mount,
  queue,
  selection,
  sentToFrame,
  teardownEditorFrame,
} from '@/test/helpers/in-place-editor';

beforeEach(installEditorFrame);
afterEach(teardownEditorFrame);

describe('what the document says', () => {
  it('composes a text edit into the source and persists it', async () => {
    mount();
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'goodbye' });
    await waitFor(() => expect(lastQueued()?.source).toContain('goodbye'));
    // '0.1' is body-relative; the source begins with the Helmet.
    expect(lastQueued()!.source).toContain('<h1 id="h">Title</h1>');
  });

  it('IGNORES an edit that does not carry this session\'s nonce', async () => {
    mount();
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'FORGED' }, null);
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'FORGED' }, 'b'.repeat(32));
    expect(queue).not.toHaveBeenCalled();
  });

  it('does not push a text edit back — the document already shows it', async () => {
    mount();
    env.posted.length = 0;
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'typed' });
    await waitFor(() => expect(queue).toHaveBeenCalled());
    expect(sentToFrame(STORY_DOCUMENT_MESSAGE)).toHaveLength(0);
  });

  it('deletes the selected node when the document reports the key', async () => {
    mount();
    await fromFrame({ type: STORY_SELECTION_MESSAGE, selection: selection() });
    await fromFrame({ type: STORY_EDIT_KEY_MESSAGE, key: 'Delete' });
    await waitFor(() => expect(lastQueued()?.source).toBeDefined());
    expect(lastQueued()!.source).not.toContain('id="lede"');
    expect(lastQueued()!.source).toContain('id="h"');
    // A structural change IS pushed: the document cannot know it otherwise.
    expect(sentToFrame(STORY_DOCUMENT_MESSAGE).length).toBeGreaterThan(0);
  });
});

describe('drafts', () => {
  /*
   * PAINT FIRST reaches the editor too. The page used to run every query
   * server-side and inline the rows into its own HTML, so the owner waited on
   * the SQL before their page existed. Now it sends the declarations, which
   * makes "no state" the ordinary arrival — and the editor has to notice, or
   * the chart panel opens on columns it never fetched.
   *
   * The signal is STATE, not the presence of a dataflow: keying on the latter
   * is what suppressed the run, because declarations alone are still a
   * dataflow.
   */
  const flowOnly = { flow: { values: [{ kind: 'table' as const, name: 'rows', rows: [{ x: 1 }], columns: [{ name: 'x', type: 'number' as const }], start: 0, end: 0 }], queries: [] } };
  const askedForQueries = () => (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
    .some((c) => String(c[0]) === '/api/query');

  it('runs the draft queries when the page sent no rows', async () => {
    mount({ art: { ...art, dataflow: flowOnly } as EditorArt });
    await waitFor(() => expect(askedForQueries()).toBe(true), { timeout: 2000 });
  });

  it('runs nothing when the rows came with the page (a capture, or an older payload)', async () => {
    mount({ art: {
      ...art,
      dataflow: { ...flowOnly, state: { values: {}, tables: {}, errors: {} } },
    } as EditorArt });
    await new Promise((r) => setTimeout(r, 700));
    expect(askedForQueries()).toBe(false);
  });

  it('compiles the draft stylesheet and gives it to the document', async () => {
    mount();
    await fromFrame({ type: STORY_TEXT_EDIT_MESSAGE, path: '0.1', innerHtml: 'a change that needs new classes' });
    await waitFor(() => {
      expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls
        .some((c) => String(c[0]).includes('/api/preview'))).toBe(true);
    }, { timeout: 2000 });
  });
});

it('keeps a refused engine fragment available for explicit recovery',async()=>{
 mount();const fragment='<p id="draft">Unsaved local words</p>';
 await fromFrame({type:'mx:flow-edit',path:'0.1',expected:'<p id="lede">stale base</p>',replacement:fragment});
 expect(screen.getByRole('alertdialog',{name:'Recover uncommitted text'})).toBeTruthy();
 expect(screen.getByRole('textbox',{name:'Uncommitted text'})).toHaveValue(fragment);
 fireEvent.click(screen.getByRole('button',{name:'Discard this text and restore document'}));
 expect(screen.queryByRole('alertdialog',{name:'Recover uncommitted text'})).toBeNull();
 expect(sentToFrame(STORY_DOCUMENT_MESSAGE).length).toBeGreaterThan(0);
});
