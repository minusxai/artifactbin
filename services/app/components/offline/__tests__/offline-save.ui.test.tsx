/**
 * The offline file's own state, in jsdom: the name it asks for, the Save
 * button's state, and the crash buffer (components/offline/OfflineApp,
 * lib/offline/local-state, lib/offline/save-file). The editing and commenting
 * themselves run in three real engines in scripts/gate-offline-file.mjs.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseArtifactFile, type ArtifactFile } from '@/lib/offline/file-format';
import { NAME_KEY, draftKey, readDraft, writeDraft } from '@/lib/offline/local-state';
import { suggestedFileName } from '@/lib/offline/save-file';
import { NOTHING_TO_SAVE, OfflineApp, UNSAVED } from '../OfflineApp';
import { NAME_QUESTION } from '../NameDialog';

const FIXTURE = path.resolve(process.cwd(), '../../scripts/fixtures/offline-file/artifact-file.json');
const fixture = (): ArtifactFile => parseArtifactFile(JSON.parse(readFileSync(FIXTURE, 'utf8')));
const CODE = 'QUJD';

/**
 * The page's own chrome lives in trusted shadow roots, in popover layers jsdom
 * never opens (so Testing Library calls them hidden); search all of them.
 */
function chrome() {
  const roots = [...document.querySelectorAll('[data-trusted-ui]')].map((host) => host.shadowRoot!).filter(Boolean);
  const all = () => roots.flatMap((root) => [...root.querySelectorAll<HTMLElement>('*')]);
  return {
    button: (name: string | RegExp) => {
      const found = all().find((el) => el.tagName === 'BUTTON' && (typeof name === 'string' ? el.textContent?.trim() === name || el.getAttribute('aria-label') === name : name.test(el.textContent ?? '')));
      if (!found) throw new Error(`no button ${String(name)}`);
      return found as HTMLButtonElement;
    },
    dialog: () => all().find((el) => el.getAttribute('role') === 'dialog') ?? null,
    text: () => roots.map((root) => root.textContent).join(' '),
  };
}

beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('the name', () => {
  it('is asked the first time someone edits, kept, and shown with a way to change it', async () => {
    render(<OfflineApp file={fixture()} code={CODE} />);
    expect(await screen.findByRole('heading', { name: 'Regional sales' })).toBeInTheDocument();
    expect(chrome().dialog()).toBeNull();
    fireEvent.click(chrome().button('Edit'));
    await waitFor(() => expect(chrome().dialog()).not.toBeNull());
    const dialog = chrome().dialog()!;
    expect(dialog).toHaveTextContent(NAME_QUESTION);
    const save = within(dialog).getByRole('button', { name: 'Save', hidden: true });
    expect(save).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Your name', hidden: true }), { target: { value: '  Asha ' } });
    fireEvent.click(save);
    await waitFor(() => expect(chrome().dialog()).toBeNull());
    expect(localStorage.getItem(NAME_KEY)).toBe('Asha');
    expect(chrome().button('You are Asha. Change your name')).toHaveTextContent('You: Asha');
  });

  it('asks once per session when the browser keeps nothing', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('SecurityError'); });
    render(<OfflineApp file={fixture()} code={CODE} />);
    await screen.findByRole('heading', { name: 'Regional sales' });
    fireEvent.click(chrome().button('Edit'));
    await waitFor(() => expect(chrome().dialog()).not.toBeNull());
    fireEvent.click(within(chrome().dialog()!).getByRole('button', { name: 'Not now', hidden: true }));
    await waitFor(() => expect(chrome().dialog()).toBeNull());
    fireEvent.click(chrome().button('Done editing'));
    await waitFor(() => chrome().button('Edit'));
    fireEvent.click(chrome().button('Edit'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(chrome().dialog()).toBeNull();
    expect(chrome().button('Set your name')).toBeInTheDocument();
  });
});

describe('Save', () => {
  it('is disabled with the reason while nothing changed', async () => {
    render(<OfflineApp file={fixture()} code={CODE} />);
    await screen.findByRole('heading', { name: 'Regional sales' });
    const save = chrome().button('Save');
    expect(save).toBeDisabled();
    expect(save).toHaveAccessibleDescription(NOTHING_TO_SAVE);
    expect(chrome().text()).not.toContain(UNSAVED);
  });

  it('restores unsaved work from the crash buffer, then writes the file to the picker with its own name', async () => {
    const file = fixture();
    const edited: ArtifactFile = { ...file, journal: [{ at: '2026-09-26T12:00:00.000Z', by: 'Asha', summary: "Edited text in 'Quarterly sales'" }] };
    writeDraft(edited, new Date('2026-09-26T12:00:05.000Z'));
    const written: string[] = [];
    const picker = vi.fn(async () => ({ createWritable: async () => ({ write: async (blob: Blob) => { written.push(await blob.text()); }, close: async () => {} }) }));
    vi.stubGlobal('showSaveFilePicker', picker);
    render(<OfflineApp file={file} code={CODE} fileName="Regional sales.html" />);
    await screen.findByRole('heading', { name: 'Regional sales' });
    await waitFor(() => expect(chrome().text()).toContain('Restore unsaved changes from'));
    fireEvent.click(chrome().button('Restore'));
    await waitFor(() => expect(chrome().text()).toContain(UNSAVED));
    expect(chrome().button(/^Changes/)).toHaveTextContent('Changes (1)');
    // Unsaved work asks before the tab closes.
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    const save = chrome().button('Save');
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(written).toHaveLength(1));
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'Regional sales.html' }));
    expect(written[0]).toContain(`<script type="application/octet-stream" id="afbin-code">${CODE}</script>`);
    expect(written[0]).toContain("Edited text in 'Quarterly sales'");
    await waitFor(() => expect(chrome().button('Save')).toBeDisabled());
    expect(chrome().text()).not.toContain(UNSAVED);
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
    // Saved: the crash buffer is gone, so the copy does not offer it again.
    expect(localStorage.getItem(draftKey(file))).toBeNull();
  });

  it('discards the crash buffer when asked', async () => {
    const file = fixture();
    writeDraft({ ...file, localIds: ['local-x'] }, new Date('2026-09-26T12:00:05.000Z'));
    render(<OfflineApp file={file} code={CODE} />);
    await waitFor(() => expect(chrome().text()).toContain('Restore unsaved changes from'));
    fireEvent.click(chrome().button('Discard'));
    await waitFor(() => expect(chrome().text()).not.toContain('Restore unsaved changes from'));
    expect(localStorage.getItem(draftKey(file))).toBeNull();
    expect(chrome().button('Save')).toBeDisabled();
  });
});

describe('the crash buffer', () => {
  it('offers only a draft of this download that is newer than the file and holds something else', () => {
    const file = fixture();
    expect(readDraft(file)).toBeNull();
    writeDraft(file, new Date('2026-09-26T12:00:00.000Z'));
    expect(readDraft(file)).toBeNull(); // the same content
    const changed = { ...file, localIds: ['local-x'] };
    writeDraft(changed, new Date('2020-01-01T00:00:00.000Z'));
    expect(readDraft(file)).toBeNull(); // older than the file itself
    writeDraft(changed, new Date('2026-09-26T12:00:00.000Z'));
    expect(readDraft(file)?.file.localIds).toEqual(['local-x']);
    localStorage.setItem(draftKey(file), '{not json');
    expect(readDraft(file)).toBeNull();
  });

  it('skips silently past the quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    expect(() => writeDraft(fixture())).not.toThrow();
  });
});

describe('the suggested file name', () => {
  it('is the name the file was opened as, else the title', () => {
    expect(suggestedFileName('Sales', { protocol: 'file:', pathname: '/Users/a/Downloads/Regional%20sales%20(2).html' })).toBe('Regional sales (2).html');
    expect(suggestedFileName('Q3: plan / draft', { protocol: 'https:', pathname: '/a/x' })).toBe('Q3 plan draft.html');
  });
});
