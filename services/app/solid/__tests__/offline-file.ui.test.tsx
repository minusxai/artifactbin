/** Solid offline chrome over the same serialized file as the three-browser gate. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/dom';
import { CHANGED_OUTSIDE } from '@/lib/offline/file-backend';
import { OFFLINE_ASSET_REASON, OFFLINE_QUERY_REASON, parseArtifactFile, type ArtifactFile } from '@/lib/offline/file-format';
import { renderArtifactFileHtml } from '@/lib/offline/file-html';
import { draftKey, readDraft, writeDraft } from '@/lib/offline/local-state';
import { suggestedFileName } from '@/lib/offline/save-file';
import { disposeSolidOfflineFile, mountSolidOfflineFile } from '@/lib/offline/solid-entry';

const FIXTURE = path.resolve(process.cwd(), '../../scripts/fixtures/offline-file/artifact-file.json');
const fixture = (): ArtifactFile => {
  const file = parseArtifactFile(JSON.parse(readFileSync(FIXTURE, 'utf8')));
  const heading = /<h1[^>]*id="([^"]+)"/.exec(file.source)?.[1];
  if (!heading) throw new Error('fixture has no heading');
  return { ...file, bundle: 'solid', compiled: {
    html: `<div data-mx-ast="1"><h1 id="${heading}" data-mx-ast="1.1">Regional sales</h1><p data-mx-ast="1.3">Revenue by region and month</p></div>`,
    islands: [], kit: { islands: [], skeleton: [] },
  } as unknown as ArtifactFile['compiled'] };
};
function shell(file: ArtifactFile) {
  const doc = new DOMParser().parseFromString(renderArtifactFileHtml({ file, code: 'QUJD' }), 'text/html');
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
}
beforeEach(() => { localStorage.clear(); document.body.innerHTML = ''; });
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
    fireEvent.click(screen.getByRole('button', { name: 'Show data' }));
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

  it('recognizes drafts by download and suggests the existing file name', () => {
    const file = fixture();
    expect(readDraft(file)).toBeNull();
    writeDraft(file, new Date('2026-09-26T12:00:00.000Z'));
    expect(readDraft(file)).toBeNull();
    writeDraft({ ...file, localIds: ['x'] }, new Date('2026-09-26T12:00:05.000Z'));
    expect(readDraft(file)?.file.localIds).toEqual(['x']);
    expect(suggestedFileName('Sales', { protocol: 'file:', pathname: '/Downloads/Regional%20sales%20(2).html' })).toBe('Regional sales (2).html');
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
