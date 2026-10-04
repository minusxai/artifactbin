/** Solid offline chrome over the same serialized file as the three-browser gate. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { CHANGED_OUTSIDE } from '@/lib/offline/file-backend';
import { OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON, parseArtifactFile, sourceDigest, type ArtifactFile } from '@/lib/offline/file-format';
import { renderArtifactFileHtml } from '@/lib/offline/file-html';
import { draftKey, readDraft, writeDraft } from '@/lib/offline/local-state';
import { suggestedFileName } from '@/lib/offline/save-file';
import { disposeSolidOfflineFile, mountSolidOfflineFile, queryConsumersOf } from '@/lib/offline/solid-entry';
import type { CompiledEditCallbacks } from '@/solid/editor/dom-mounter';

// The real mounter, with the callbacks the offline shell hands it kept for the flow-edit cases.
const mounted = vi.hoisted(() => ({ callbacks: null as CompiledEditCallbacks | null }));
vi.mock('@/solid/editor/dom-mounter', async (real) => {
  const actual = await real<typeof import('@/solid/editor/dom-mounter')>();
  return {
    ...actual,
    mountCompiledEditRegions: (...args: Parameters<typeof actual.mountCompiledEditRegions>) => {
      mounted.callbacks = args[2];
      return actual.mountCompiledEditRegions(...args);
    },
  };
});

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
function shell(file: ArtifactFile) {
  const doc = new DOMParser().parseFromString(renderArtifactFileHtml({ file, code: 'QUJD' }), 'text/html');
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
}
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; mounted.callbacks = null; });

/** A file whose source, as downloaded, has two identical paragraphs right after the description (body paths 1.5 and 1.7). */
const TWICE = '<p>Same words.</p>';
const withTwice = (file: ArtifactFile): ArtifactFile => {
  const source = file.source.replace(/(<p className="text-muted-foreground"[^\n]*<\/p>)/, `$1\n  ${TWICE}\n  ${TWICE}`);
  return { ...file, source, derivedFrom: sourceDigest(source) };
};
/** Open the file as a reader who has already given a name, and start editing on the page. */
async function openAndEdit(file: ArtifactFile): Promise<CompiledEditCallbacks> {
  localStorage.setItem('afbin-offline-name', 'Asha');
  shell(file); await mountSolidOfflineFile();
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(mounted.callbacks).not.toBeNull());
  return mounted.callbacks!;
}
const shownSource = (): string => {
  fireEvent.click(screen.getByRole('tab', { name: 'Edit the source' }));
  return (screen.getByRole('textbox', { name: 'Markup source' }) as HTMLTextAreaElement).value;
};
afterEach(() => { disposeSolidOfflineFile(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Solid offline file', () => {
  it('shows the offline identity, data time, live link and disabled Save reason', async () => {
    const file = fixture(); shell(file); await mountSolidOfflineFile();
    const bar = screen.getByRole('banner', { name: 'Offline copy' });
    expect(bar.textContent).toContain(`Offline copy of ${file.metadata.title}`);
    expect(bar.textContent).toContain('data as of');
    expect(bar.querySelector('time')?.dateTime).toBe(file.snapshot.at);
    expect(screen.getByRole('link', { name: 'Open live version' }).getAttribute('href')).toBe(file.liveUrl);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-description')).toBe('No changes to save');
  });

  it('asks for a name before editing, remembers it, and explains unavailable controls', async () => {
    shell(fixture()); await mountSolidOfflineFile();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'What should we call you?' });
    fireEvent.input(screen.getByRole('textbox', { name: 'Your name' }), { target: { value: 'Asha' } });
    fireEvent.click(dialog.querySelector('button')!);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(localStorage.getItem('afbin-offline-name')).toBe('Asha');
    expect(screen.getByRole('button', { name: 'You: Asha' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'History' }).getAttribute('aria-description')).toContain('Version history lives on artifactbin');
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Image…' }));
    expect(screen.getByRole('textbox', { name: 'Image URL' }).getAttribute('aria-description')).toBe(OFFLINE_ASSET_REASON);
    fireEvent.click(screen.getByRole('tab', { name: 'Show data' }));
    expect(document.body.textContent).toContain(OFFLINE_QUERY_REASON);
  });

  it('offers a newer crash draft and restores or discards only by choice', async () => {
    const file = fixture();
    writeDraft({ ...file, localIds: ['local-x'] }, new Date('2026-09-26T12:00:05.000Z'));
    shell(file);
    const opening = mountSolidOfflineFile();
    expect(await screen.findByRole('alertdialog', { name: 'Restore unsaved changes' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await opening;
    expect(document.body.textContent).toContain('Unsaved changes');
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
    expect(document.body.textContent).toContain('Unsaved changes');
    fireEvent.click(screen.getByRole('button', { name: /^Changes/ }));
    expect(screen.getByRole('region', { name: 'Changes in this file' }).textContent).toContain(CHANGED_OUTSIDE);
    disposeSolidOfflineFile();
    shell({ ...file, source: file.source.replace('<Button run', '<p>{$missing}</p>\n  <Button run') });
    await mountSolidOfflineFile();
    expect(screen.getByRole('heading', { name: 'Regional sales' })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/\$missing.*refers to nothing declared/);
    expect(screen.getByRole('button', { name: 'Edit' }).hasAttribute('disabled')).toBe(true);
  });

  it('renders added structure after accepting source, saving and reopening', async () => {
    const file = fixture();
    await openAndEdit(file);
    fireEvent.click(screen.getByRole('tab', { name: 'Edit the source' }));
    const source = screen.getByRole('textbox', { name: 'Markup source' });
    const next = file.source.replace('Regional sales</h1>', 'Regional sales</h1><section id="new-section"><h2>Added offline</h2><p>A new paragraph.</p></section>');
    fireEvent.input(source, { target: { value: next } });
    const written: string[] = [];
    vi.stubGlobal('showSaveFilePicker', async () => ({ createWritable: async () => ({
      write: async (blob: Blob) => { written.push(await blob.text()); }, close: async () => {},
    }) }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(written).toHaveLength(1));
    expect(screen.getByRole('heading', { name: 'Added offline' })).toBeTruthy();
    disposeSolidOfflineFile();
    const saved = parseArtifactFile(JSON.parse(/<script type="application\/json" id="afbin-file">([^<]*)<\/script>/.exec(written[0]!)![1]!));
    shell(saved); await mountSolidOfflineFile();
    expect(screen.getByRole('heading', { name: 'Added offline' })).toBeTruthy();
    expect(document.querySelector('#new-section')?.textContent).toContain('A new paragraph.');
    expect(saved.compiled).toEqual(file.compiled);
  });

  it('keeps rejected textarea drafts unsaved and refuses Save without discarding them', async () => {
    const file = fixture();
    await openAndEdit(file);
    fireEvent.click(screen.getByRole('tab', { name: 'Edit the source' }));
    const source = screen.getByRole('textbox', { name: 'Markup source' }) as HTMLTextAreaElement;
    const rejected = file.source.replace('Regional sales</h1>', 'Regional sales</h1><script>alert(1)</script>');
    fireEvent.input(source, { target: { value: rejected } });
    const picker = vi.fn(); vi.stubGlobal('showSaveFilePicker', picker);
    expect(screen.getByRole('button', { name: 'Save' }).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getAllByRole('status').some((status) => status.textContent?.includes('not saved'))).toBe(true));
    expect(picker).not.toHaveBeenCalled();
    expect(source.value).toBe(rejected);
    expect(document.body.textContent).toContain('Unsaved changes');
    expect(screen.getByRole('heading', { name: 'Regional sales' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Fix the source'));
  });

  it('retains newer rejected typing when an earlier accepted save finishes', async () => {
    const file = fixture(); await openAndEdit(file);
    fireEvent.click(screen.getByRole('tab', { name: 'Edit the source' }));
    const textarea = screen.getByRole('textbox', { name: 'Markup source' }) as HTMLTextAreaElement;
    const accepted = file.source.replace('Regional sales</h1>', 'Changed heading</h1>');
    fireEvent.input(textarea, { target: { value: accepted } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const newer = `${accepted}<script>bad()</script>`;
    fireEvent.input(textarea, { target: { value: newer } });
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Fix the source'));
    expect(textarea.value).toBe(newer);
    expect(document.body.textContent).toContain('Unsaved changes');
  });

  it('restores a rejected source draft separately from the last valid document', async () => {
    const file = fixture();
    const rejected = `${file.source}<script>bad()</script>`;
    writeDraft(file, new Date('2026-10-04T00:00:00Z'), rejected);
    shell(file);
    const opening = mountSolidOfflineFile();
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    await opening;
    expect((screen.getByRole('textbox', { name: 'Markup source' }) as HTMLTextAreaElement).value).toBe(rejected);
    expect(screen.getByRole('heading', { name: 'Regional sales' })).toBeTruthy();
    expect(document.body.textContent).toContain('Unsaved changes');
  });

  it('refuses new compiled components without saving or blanking the valid reader', async () => {
    const file = fixture();
    await openAndEdit(file);
    fireEvent.click(screen.getByRole('tab', { name: 'Edit the source' }));
    const source = screen.getByRole('textbox', { name: 'Markup source' }) as HTMLTextAreaElement;
    const next = file.source.replace('Regional sales</h1>', 'Regional sales</h1><Card><p>New kit shell</p></Card>');
    fireEvent.input(source, { target: { value: next } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Fix the source'));
    expect(source.value).toBe(next);
    expect(screen.getByRole('heading', { name: 'Regional sales' })).toBeTruthy();
    expect(document.body.textContent).toContain('local compiler');
  });

  it('edits the paragraph at the edited path, not the first paragraph with the same words', async () => {
    const file = withTwice(fixture());
    expect(file.source.split(TWICE)).toHaveLength(3);
    const callbacks = await openAndEdit(file);
    callbacks.onFlow('1.7', TWICE, '<p>Other words.</p>');
    expect(shownSource()).toContain(`${TWICE}\n  <p>Other words.</p>`);
  });

  it('leaves the source unchanged and says so when an edit is not prose', async () => {
    const file = withTwice(fixture());
    const callbacks = await openAndEdit(file);
    callbacks.onFlow('1.7', TWICE, '<Button run="$add">Add a row</Button>');
    expect(screen.getAllByRole('status').map((status) => status.textContent)).toContain('This text could not be applied to the current document.');
    const source = shownSource();
    expect(source.split(TWICE)).toHaveLength(3);
    expect(source).not.toContain('<Button run="$add">Add a row</Button>');
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
    expect(suggestedFileName('Sales', { protocol: 'file:', pathname: '/Downloads/Regional%20sales%20(2).html' })).toBe('Regional sales (2).html');
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
});
