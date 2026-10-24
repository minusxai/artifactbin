// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { AfFileUpload, registerFileUpload } from './file-upload';
import type { AfUploadFile } from './file-upload-model';
registerFileUpload();
afterEach(() => document.body.replaceChildren());
function fixture() { const element = document.createElement('af-file-upload') as AfFileUpload; document.body.append(element); return element; }
const file = () => new File(['a'], 'photo.png', { type: 'image/png' });
it('reports cancelable controlled changes, removes only references, and preserves authored identities', async () => {
  const element = fixture(); element.insertAdjacentHTML('beforeend', '<span data-af-id="authored">Help</span>');
  element.value = []; element.adapter = { upload: async () => ({ ref: 'one', name: 'photo.png' }) };
  const changes: AfUploadFile[][] = [];
  element.onChange = detail => { changes.push(detail.value); };
  await element.upload([file()]); expect(changes[0]?.[0]?.ref).toBe('one'); expect(element.value).toEqual([]);
  element.value = changes[0]!;
  element.addEventListener('af-change', event => event.preventDefault());
  element.querySelector<HTMLButtonElement>('[aria-label="Remove photo.png"]')!.click();
  expect(element.value).toHaveLength(1); expect(changes).toHaveLength(1);
  expect(element.querySelector('[data-af-id="authored"]')).not.toBeNull();
});
it('aborts and ignores completion after external reset, dataset changes, and disconnect', async () => {
  for (const invalidate of [(e: AfFileUpload) => { e.value = []; }, (e: AfFileUpload) => { e.datasetName = 'other'; }, (e: AfFileUpload) => e.remove()]) {
    const element = fixture(); let resolve!: (value: AfUploadFile) => void; let signal!: AbortSignal;
    element.adapter = { upload: (_file, context) => { signal = context.signal; return new Promise(r => { resolve = r; }); } };
    const change = vi.fn(); element.onChange = change;
    const pending = element.upload([file()]); invalidate(element); resolve({ ref: 'late', name: 'late.png' }); await pending;
    expect(signal.aborted).toBe(true); expect(change).not.toHaveBeenCalled(); expect(element.busy).toBe(false);
  }
});
it('retains partial successes and retries the identical file', async () => {
  const element = fixture(); element.multiple = true;
  const adapter = vi.fn().mockResolvedValueOnce({ ref: 'a', name: 'a.png' }).mockRejectedValueOnce(new Error('Try again')).mockResolvedValueOnce({ ref: 'b', name: 'photo.png' });
  element.adapter = { upload: adapter }; const failed = file();
  await element.upload([file(), failed]); expect(element.value).toHaveLength(1);
  element.querySelector<HTMLButtonElement>('[aria-label="Retry photo.png"]')!.click();
  await vi.waitFor(() => expect(element.value).toHaveLength(2)); expect(adapter.mock.calls[2]?.[0]).toBe(failed);
});
it('accepts synchronous author state updates across a batch and blocks invalid picker selections', async () => {
  const element = fixture(); element.multiple = true; element.value = [];
  const upload = vi.fn(async (file: File) => ({ ref: file.name, name: file.name })); element.adapter = { upload };
  element.onChange = detail => { element.value = detail.value; };
  await element.upload([file(), new File(['b'], 'other.png', { type: 'image/png' })]);
  expect(element.value).toHaveLength(2); expect(element.busy).toBe(false);
  element.setAttribute('accept', 'image/png');
  await element.upload([new File(['x'], 'x.txt', { type: 'text/plain' })]);
  expect(upload).toHaveBeenCalledTimes(2); expect(element.querySelector('[role="alert"]')?.textContent).toContain('accepted');
  element.setAttribute('max-files', '2'); await element.upload([file()]);
  expect(upload).toHaveBeenCalledTimes(2); expect(element.querySelector('[role="alert"]')?.textContent).toContain('at most 2');
});
