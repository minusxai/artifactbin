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
  for (const invalidate of [(e: AfFileUpload) => { e.value = []; }, (e: AfFileUpload) => { e.datasetName = 'other'; }, (e: AfFileUpload) => e.remove(), (e: AfFileUpload) => e.reset(), (e: AfFileUpload) => { e.disabled = true; }]) {
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
it('reflects event-controlled state across a batch without aborting and preserves picker and row focus', async () => {
  const element = fixture(); element.multiple = true; element.value = [];
  element.adapter = { upload: async f => ({ ref: f.name, name: f.name }) };
  element.addEventListener('af-change', event => { element.value = (event as CustomEvent<{ value: AfUploadFile[] }>).detail.value; });
  const picker = element.querySelector('input');
  await element.upload([file(), new File(['b'], 'b.png')]); expect(element.value).toHaveLength(2);
  const row = element.querySelector('li'); const remove = row!.querySelector('button')!; remove.focus();
  element.setAttribute('label', 'Photos'); expect(element.querySelector('input')).toBe(picker); expect(element.querySelector('li')).toBe(row); expect(document.activeElement).toBe(remove);
  remove.click(); expect(document.activeElement?.getAttribute('aria-label')).toBe('Remove b.png');
});
it('rejects unsafe adapter metadata and links and tolerates invalid runtime values', async () => {
  const element = fixture(); element.value = null as unknown as AfUploadFile[];
  expect(element.value).toEqual([]);
  element.adapter = { upload: async () => ({ ref: '', name: 'bad' }), fileUrl: () => 'javascript:alert(1)' };
  await element.upload([file()]); expect(element.querySelector('[role="alert"]')?.textContent).toContain('invalid');
  element.value = [{ ref: 'ok', name: 'safe' }]; expect(element.querySelector('a')).toBeNull();
});

it('keeps active requests on presentation changes and resets the same picker before upload', async () => {
  const element = fixture(); let resolve!: (value: AfUploadFile) => void; let signal!: AbortSignal;
  element.adapter = { upload: (_file, context) => { signal = context.signal; return new Promise(r => { resolve = r; }); } };
  const input = element.querySelector('input')!; Object.defineProperty(input, 'files', { configurable: true, value: [file()] });
  input.dispatchEvent(new Event('change')); expect(input.value).toBe('');
  element.setAttribute('label', 'New label'); element.setAttribute('accept', 'image/*'); expect(signal.aborted).toBe(false);
  resolve({ ref: 'a', name: 'a' }); await vi.waitFor(() => expect(element.busy).toBe(false)); expect(element.querySelector('input')).toBe(input);
  input.dispatchEvent(new Event('change')); expect(element.busy).toBe(true); element.reset();
});

it('keeps picker guidance and renders successful dataset references as downloadable files', async () => {
  const element = fixture();
  element.datasetName = 'attachments';
  element.multiple = true;
  element.setAttribute('accept', 'image/png,.jpg');
  const input = element.querySelector<HTMLInputElement>('input')!;
  expect(input.accept).toBe('image/png,.jpg');
  expect(input.multiple).toBe(true);

  element.adapter = {
    upload: async (_file, context) => {
      expect(context.dataset).toBe('attachments');
      expect(context.signal.aborted).toBe(false);
      return { ref: 'dfile:abc123', name: 'photo.png', contentType: 'image/png', size: 3 };
    },
    fileUrl: (uploaded, dataset) => `/datasets/${dataset}/files/${uploaded.ref.slice('dfile:'.length)}`,
  };
  await element.upload([file()]);

  const link = element.querySelector<HTMLAnchorElement>('a');
  expect(link?.href).toBe('http://localhost:3000/datasets/attachments/files/abc123');
  expect(link?.download).toBe('photo.png');
  expect(link?.textContent).toBe('photo.png');
  expect(element.querySelector('img')?.getAttribute('alt')).toBe('photo.png');
  expect(element.textContent).toContain('3 bytes');
  expect(element.value).toEqual([{ ref: 'dfile:abc123', name: 'photo.png', contentType: 'image/png', size: 3 }]);
});

it('keeps the supported signed-out or unbound state unavailable until an adapter is supplied', async () => {
  const element = fixture();
  const choose = element.querySelector<HTMLButtonElement>('button')!;
  const input = element.querySelector<HTMLInputElement>('input')!;
  expect(choose.disabled).toBe(true);
  expect(input.disabled).toBe(true);
  await element.upload([file()]);
  expect(element.value).toEqual([]);

  element.adapter = { upload: async f => ({ ref: 'ok', name: f.name }) };
  expect(element.querySelector('button')?.hasAttribute('disabled')).toBe(false);
  element.disabled = true;
  expect(element.querySelector('button')?.hasAttribute('disabled')).toBe(true);
  await element.upload([file()]);
  expect(element.value).toEqual([]);
});

// Retained FileUpload uses a visually clipped input, not a hidden accessibility node.
it('keeps the named file picker accessible while unavailable and delegates the chooser when enabled', () => {
  const element = fixture(); element.setAttribute('label', 'Screenshots');
  const input = element.querySelector('input')!;
  expect(input.hidden).toBe(false);
  expect(input.tabIndex).toBe(-1);
  expect(input.getAttribute('aria-label')).toBe('Choose Screenshots');
  expect(input.disabled).toBe(true);
  const click = vi.spyOn(input, 'click');
  element.adapter = { upload: async () => ({ref:'one',name:'file'}) };
  expect(element.querySelector('input')).toBe(input);
  expect(input.disabled).toBe(false);
  element.querySelector<HTMLButtonElement>('[aria-label="Choose Screenshots"]')!.click();
  expect(click).toHaveBeenCalledOnce();
  element.disabled = true;
  expect(input.disabled).toBe(true);
});
