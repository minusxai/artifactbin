import { replaceComment } from '../document/__tests__/comment-input';
/** Solid offline chrome over the same serialized file as the three-browser gate. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { screen, trustedText, trustedQuery } from './trusted-screen';
import { CHANGED_OUTSIDE } from '@/lib/offline/file-backend';
import { OFFLINE_QUERY_REASON, parseArtifactFile, type ArtifactFile } from '@/lib/offline/file-format';
import { renderArtifactFileHtml } from '@/lib/offline/file-html';
import { draftKey, readDraft, writeDraft } from '@/lib/offline/local-state';
import { suggestedFileName } from '@/lib/offline/save-file';
import { disposeSolidOfflineFile, mountSolidOfflineFile, queryConsumersOf } from '@/lib/offline/solid-entry';
import { preloadCommentField } from '../document/LazyCommentField';

const FIXTURE = path.resolve(process.cwd(), '../../scripts/fixtures/offline-file/artifact-file.json');
const fixture = (): ArtifactFile => {
  const file = parseArtifactFile(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  const heading = /<h1[^>]*id="([^"]+)"/.exec(file.source)?.[1];
  if (!heading) throw new Error('fixture has no heading');
  return { ...file, bundle: 'solid', compiled: {
    // 1.7 is the real fixture's `<DataTable data="$sales">` (dashboard.jsx via
    // artifact-file.json), one Solid tree's own island path never names (PR #202).
    html: `<div data-mx-ast="1"><h1 id="${heading}" data-mx-ast="1.1">Regional sales</h1><p data-mx-ast="1.3">Revenue by region and month</p><div data-mx-ast="1.7">2026-07 rows</div></div>`,
    islands: [], kit: { islands: [], skeleton: [] },
  } as unknown as ArtifactFile['compiled'] };
};
const withComment = (file: ArtifactFile): ArtifactFile => ({ ...file, threads: [{
  id: 'ann_server', status: 'open', anchor: null, orphaned: true, anchor_version: 1, snippet: 'Regional sales', quote: null, range: null, quote_found: null,
  thread: [{ id: 'ann_server', body: 'Original comment', author: { kind: 'human', label: 'Ravi', transport: 'browser', user_id: 'u1', image: null }, created_at: '2026-09-25T00:00:00.000Z' }],
  created_at: '2026-09-25T00:00:00.000Z', resolved_at: null,
}] });
function shell(file: ArtifactFile) {
  const doc = new DOMParser().parseFromString(renderArtifactFileHtml({ file, code: 'QUJD' }), 'text/html');
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
}
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });

afterEach(() => { disposeSolidOfflineFile(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Solid offline file', () => {
  beforeAll(() => preloadCommentField());
  it('synchronizes the document root with the opened file metadata', async () => {
    const original = fixture();
    const file = { ...original, metadata: { ...original.metadata, theme: 'manuscript', colorMode: 'dark' as const } };
    shell(file);
    document.documentElement.setAttribute('data-theme', 'stale');
    document.documentElement.classList.add('light');
    await mountSolidOfflineFile();
    expect(document.documentElement.getAttribute('data-theme')).toBe('manuscript');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.classList.contains('light')).toBe(false);
    disposeSolidOfflineFile();
    shell({ ...file, metadata: { ...file.metadata, theme: null, colorMode: null } });
    await mountSolidOfflineFile();
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('uses the shared page bar and protects document controls from author CSS', async () => {
    shell(fixture());
    await mountSolidOfflineFile();
    const host = document.querySelector('[data-trusted-ui]');
    expect(host?.shadowRoot).toBeTruthy();
    const bar = host!.shadowRoot!.querySelector('header[aria-label="Page bar"]');
    expect(bar).toBeTruthy();
    expect(bar!.textContent).toContain(fixture().metadata.title);
    expect(document.querySelector('header[aria-label="Offline copy"]')).toBeNull();
  });

  it('does not offer a reload or a live link for an unpublished local file', async () => {
    shell({ ...fixture(), liveUrl: '' }); await mountSolidOfflineFile();
    expect(screen.queryByRole('link', { name: 'Home' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
    expect(screen.queryByRole('link', { name: 'Open live version' })).toBeNull();
  });

  it('reserves the comment rail beside the document, using a phone sheet on resize', async () => {
    vi.stubGlobal('innerWidth', 1024);
    localStorage.setItem('afbin-offline-name', 'Asha');
    shell(withComment(fixture())); await mountSolidOfflineFile();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    await screen.findByLabelText('Annotation sidebar');
    expect(document.body.style.marginRight).toBe('320px');
    vi.stubGlobal('innerWidth', 390); fireEvent(window, new Event('resize'));
    await screen.findByRole('dialog', { name: 'Annotation sidebar' });
    expect(document.body.style.marginRight).toBe('');
  });

  it('closes the shared Connect dialog with Escape and restores focus to its trigger', async () => {
    shell(fixture()); await mountSolidOfflineFile();
    const trigger = screen.getByRole('button', { name: 'Connect to server' });
    trigger.focus(); fireEvent.click(trigger);
    const input = screen.getByRole('textbox', { name: 'Server address' }); input.focus();
    fireEvent.keyDown(input, { key: 'Escape', composed: true, bubbles: true });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Connect to server' })).toBeNull());
    expect(trigger.getRootNode()).toHaveProperty('activeElement', trigger);
  });

  it('asks for a local name on a shared-thread reply and preserves a cancelled draft', async () => {
    shell(withComment(fixture())); await mountSolidOfflineFile();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open annotation thread' }));
    const reply = screen.getByRole('textbox', { name: 'Reply to annotation' });
    replaceComment(reply, 'Keep this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await screen.findByRole('dialog', { name: 'What should we call you?' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Your draft is saved here'));
    expect(reply.textContent).toBe('Keep this draft');
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await screen.findByRole('dialog', { name: 'What should we call you?' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: 'Asha' } });
    const dialog = screen.getByRole('dialog', { name: 'What should we call you?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByLabelText('Annotation thread').textContent).toContain('Asha'));
  });

  it('replies and resolves using the shared thread UI, then saves and reopens the conversation', async () => {
    localStorage.setItem('afbin-offline-name', 'Asha');
    const file = withComment(fixture());
    let written = '';
    vi.stubGlobal('showSaveFilePicker', vi.fn(async () => ({ name: 'conversation.jsx.html', createWritable: async () => ({ write: async (blob: Blob) => { written = await blob.text(); }, close: async () => {} }) })));
    shell(file); await mountSolidOfflineFile();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open annotation thread' }));
    replaceComment(screen.getByRole('textbox', { name: 'Reply to annotation' }), 'Reviewed offline');
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(trustedText()).toContain('Reviewed offline'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Resolve annotation' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Resolve annotation' }));
    await screen.findByLabelText('Resolved annotation thread');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(written).toContain('Reviewed offline'));
    const saved = parseArtifactFile(JSON.parse(/<script type="application\/json" id="afbin-file">([^<]*)<\/script>/.exec(written)![1]!));
    expect(saved.threads[0]?.status).toBe('resolved');
    expect(saved.threads[0]?.thread.map(comment => comment.author.label)).toEqual(['Ravi', 'Asha']);
    disposeSolidOfflineFile(); shell(saved); await mountSolidOfflineFile();
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    const reopened = await screen.findByLabelText('Resolved annotation thread');
    fireEvent.click(screen.getByRole('button', { name: 'Show resolved conversation' }));
    expect(reopened.textContent).toContain('Reviewed offline');
    expect(reopened.textContent).toContain('Asha');
  });

  it.each(['ctrlKey', 'metaKey'] as const)('uses %s+S to save the edited portable file and explains its selected target', async (modifier) => {
    const file = fixture();
    const written: string[] = [];
    const picker = vi.fn(async () => ({ name: 'chosen.jsx.html', createWritable: async () => ({
      write: async (blob: Blob) => { written.push(await blob.text()); }, close: async () => {},
    }) }));
    vi.stubGlobal('showSaveFilePicker', picker);
    shell({ ...file, source: file.source.replace('Regional sales</h1>', 'Saved with the shortcut</h1>') });
    await mountSolidOfflineFile();
    await waitFor(() => expect(screen.getByRole('button', { name: /^(Save|Download updated file)$/ }).hasAttribute('disabled')).toBe(false));
    const event = new KeyboardEvent('keydown', { key: 's', [modifier]: true, bubbles: true, composed: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(written).toHaveLength(1));
    const saved = parseArtifactFile(JSON.parse(/<script type="application\/json" id="afbin-file">([^<]*)<\/script>/.exec(written[0]!)![1]!));
    expect(saved.source).toContain('Saved with the shortcut');
    expect(saved.threads).toEqual(file.threads);
    await waitFor(() => expect(trustedText()).toContain('chosen.jsx.html'));
    expect(trustedText()).toMatch(/tab.*(?:stays|still)|(?:reopen|open).*saved file/i);
    expect(trustedText()).not.toContain('Unsaved changes');
  });

  it('sizes the document offset to wrapped chrome and restores the body style on disposal', async () => {
    const previous = document.body.style.paddingTop;
    document.body.style.paddingTop = '11px';
    let resize!: ResizeObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) { resize = callback; }
      observe() {} disconnect = disconnect;
    });
    shell(fixture()); await mountSolidOfflineFile();
    const chrome = trustedQuery('#afbin-chrome')!;
    vi.spyOn(chrome, 'getBoundingClientRect').mockReturnValue({ height: 96.3 } as DOMRect);
    resize([], {} as ResizeObserver);
    expect(document.body.style.paddingTop).toBe('97px');
    const browserSaveAs = new KeyboardEvent('keydown', { key: 's', ctrlKey: true, shiftKey: true, bubbles: true, composed: true, cancelable: true });
    document.dispatchEvent(browserSaveAs);
    expect(browserSaveAs.defaultPrevented).toBe(false);
    disposeSolidOfflineFile();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(document.body.style.paddingTop).toBe('11px');
    document.body.style.paddingTop = previous;
  });

  it('reuses the selected save target and preserves edits made while a write is pending', async () => {
    const file = withComment(fixture());
    let finish!: () => void;
    let delayWrite = true;
    const written: string[] = [];
    const picker = vi.fn(async (_options: unknown) => ({ name: 'kept.jsx.html', createWritable: async () => ({
      write: async (blob: Blob) => { written.push(await blob.text()); if (delayWrite) await new Promise<void>((resolve) => { finish = resolve; }); }, close: async () => {},
    }) }));
    vi.stubGlobal('showSaveFilePicker', picker);
    localStorage.setItem('afbin-offline-name', 'Asha');
    shell({ ...file, source: file.source.replace('Regional sales</h1>', 'Local report</h1>') }); await mountSolidOfflineFile();
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(written).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open annotation thread' }));
    replaceComment(screen.getByRole('textbox', { name: 'Reply to annotation' }), 'Comment while saving');
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    await waitFor(() => expect(trustedText()).toContain('Comment while saving'));
    fireEvent.keyDown(document, { key: 's', metaKey: true });
    expect(written).toHaveLength(1);
    finish();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false));
    expect(trustedText()).toContain('Unsaved changes');
    expect(readDraft(file)?.file.threads.some((thread) => thread.thread.some((reply) => reply.body === 'Comment while saving'))).toBe(true);
    delayWrite = false;
    fireEvent.keyDown(document, { key: 's', ctrlKey: true });
    await waitFor(() => expect(written).toHaveLength(2));
    await waitFor(() => expect(trustedText()).not.toContain('Unsaved changes'));
    expect(picker).toHaveBeenCalledTimes(1);
    expect(picker.mock.calls[0]?.[0]).toMatchObject({ suggestedName: `${file.artifactId}-regional-sales.jsx.html` });
    expect(trustedText()).toContain('kept.jsx.html');
    expect(written[1]).toContain('Comment while saving');
  });

  it('shows the offline identity, data time, live link and disabled Save reason', async () => {
    const file = fixture(); shell(file); await mountSolidOfflineFile();
    const bar = screen.getByRole('banner', { name: 'Page bar' });
    expect(bar.textContent).toContain(file.metadata.title);
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
    expect(trustedText()).toContain('Data as of');
    expect(trustedQuery('time')?.getAttribute('datetime')).toBe(file.snapshot.at);
    expect(screen.getByRole('link', { name: 'Open live version' }).getAttribute('href')).toBe(file.liveUrl);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-description')).toBe('No changes to save');
  });

  it('offers a newer crash draft and restores or discards only by choice', async () => {
    const file = fixture();
    writeDraft({ ...file, localIds: ['local-x'] }, new Date('2026-09-26T12:00:05.000Z'));
    shell(file);
    const opening = mountSolidOfflineFile();
    expect(await screen.findByRole('alertdialog', { name: 'Restore unsaved changes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await opening;
    expect(trustedText()).toContain('Unsaved changes');
    disposeSolidOfflineFile();
    shell(file);
    const next = mountSolidOfflineFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await next;
    expect(readDraft(file)).toBeNull();
    expect(localStorage.getItem(draftKey(file))).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(true);
  });

  it('rebuilds an agent text edit and refuses invalid source while keeping the last good view', async () => {
    const file = fixture();
    shell({ ...file, source: file.source.replace('Regional sales</h1>', 'Quarterly sales</h1>') });
    await mountSolidOfflineFile();
    expect(screen.getByRole('heading', { name: 'Quarterly sales' })).toBeTruthy();
    expect(trustedText()).toContain('Unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' }));
    fireEvent.click(screen.getByRole('button', { name: /^Changes/ }));
    expect(screen.getByRole('region', { name: 'Changes in this file' }).textContent).toContain(CHANGED_OUTSIDE);
    disposeSolidOfflineFile();
    shell({ ...file, source: file.source.replace('<Button run', '<p>{$missing}</p>\n  <Button run') });
    await mountSolidOfflineFile();
    expect(screen.getByRole('heading', { name: 'Regional sales' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/\$missing.*refers to nothing declared/);
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('locates $query consumers by their AST path, not the one-tree island list', () => {
    const { nodes } = fixture().island;
    expect(queryConsumersOf(nodes, new Set(['sales']))).toEqual(['1.7', '1.9']);
    expect(queryConsumersOf(nodes, new Set(['matches']))).toEqual(['1.11.1']);
    expect(queryConsumersOf(nodes, new Set())).toEqual([]);
    expect(queryConsumersOf(nodes, new Set(['no-such-query']))).toEqual([]);
  });

  it('shows the changed-query banner at the query\'s own consumer, not a stale row', async () => {
    const file = fixture();
    shell({ ...file, source: file.source.replace(
      'select region, month, revenue from sales_data.rows where',
      'select region, month, revenue * 2 as revenue from sales_data.rows where',
    ) });
    await mountSolidOfflineFile();
    const table = document.querySelector('[data-mx-ast="1.7"]')!;
    expect(table.textContent).toBe(OFFLINE_QUERY_REASON);
    expect(document.querySelector('[data-mx-inline-story]')!.textContent).not.toContain('2026-07 rows');
  });

  it('recognizes drafts by download and suggests the existing file name', () => {
    const file = fixture();
    expect(readDraft(file)).toBeNull();
    writeDraft(file, new Date('2026-09-26T12:00:00.000Z'));
    expect(readDraft(file)).toBeNull();
    writeDraft({ ...file, localIds: ['x'] }, new Date('2026-09-26T12:00:05.000Z'));
    expect(readDraft(file)?.file.localIds).toEqual(['x']);
    expect(suggestedFileName(file, { protocol: 'file:', pathname: '/Downloads/Regional%20sales%20(2).html' })).toBe('Regional sales (2).html');
    expect(suggestedFileName(file, { protocol: 'file:', pathname: '/Downloads/chosen.jsx.html' })).toBe('chosen.jsx.html');
    expect(suggestedFileName({ ...file, artifactId:'4B7rjX', metadata:{ ...file.metadata,title:'Artifact + run: a proposal' } }, { protocol:'https:',pathname:'/a/4B7rjX' })).toBe('4B7rjX-artifact-run-a-proposal.jsx.html');
  });

  it('saves the compiled story exactly as downloaded, never spliced with edited text', async () => {
    // The compiled module boot() hydrates is unchanged by an edit (file-backend.ts `derive`
    // never touches `compiled`): splicing edited text into a saved copy of it before Save
    // (the old `revisedCompiled`) left a reopen hydrating a copy hydrate() no longer matches,
    // blanking the region. Save must hand the ORIGINAL compiled pair back, unchanged.
    const file = fixture();
    const edited = { ...file, source: file.source.replace('Regional sales</h1>', 'Quarterly sales</h1>') };
    const written: string[] = [];
    vi.stubGlobal('showSaveFilePicker', async () => ({ createWritable: async () => ({
      write: async (blob: Blob) => { written.push(await blob.text()); }, close: async () => {},
    }) }));
    shell(edited);
    await mountSolidOfflineFile();
    expect(screen.getByRole('heading', { name: 'Quarterly sales' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(written).toHaveLength(1));
    const json = /<script type="application\/json" id="afbin-file">([^<]*)<\/script>/.exec(written[0]!)?.[1];
    const savedCompiled = JSON.parse(json!).compiled;
    expect(savedCompiled.html).toBe(file.compiled!.html);
    expect(savedCompiled.html).not.toContain('Quarterly');
  });

  it('migrates an older saved payload in a Solid shell when its compiled view is available', async () => {
    const file = { ...fixture(), bundle: 'core' as const };
    const written: string[] = [];
    vi.stubGlobal('showSaveFilePicker', async () => ({ createWritable: async () => ({
      write: async (blob: Blob) => { written.push(await blob.text()); }, close: async () => {},
    }) }));
    shell(file); await mountSolidOfflineFile();
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(written).toHaveLength(1));
    const json = /<script type="application\/json" id="afbin-file">([^<]*)<\/script>/.exec(written[0]!)?.[1];
    expect(JSON.parse(json!).bundle).toBe('solid');
  });
  it('offers reading and comments without source or prose editing', async () => {
    shell(fixture()); await mountSolidOfflineFile();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Edit the source' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Markup source' })).toBeNull();
    expect(document.querySelector('[data-mx-inline-story] [contenteditable="true"]')).toBeNull();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeTruthy();
  });
});
