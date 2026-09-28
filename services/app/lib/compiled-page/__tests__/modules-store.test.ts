// DESTINATION: services/app/lib/compiled-page/__tests__/modules-store.test.ts
/** Per-document module bytes, content-addressed in the object store (lib/compiled-page/modules.server; contract ModuleStore). */
import { describe, expect, it } from 'vitest';
import { createModuleStore } from '../modules.server';
import { DOCUMENT_MODULE_PATH, DOCUMENT_MODULE_RE } from '../contract';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('createModuleStore', () => {
  it('stores bytes under their digest and hands back the ref a page imports', async () => {
    const store = createModuleStore();
    const ref = await store.put(bytes('export const a = 1;'), ['/islands/rt-abc.js']);
    expect(ref.sha).toMatch(DOCUMENT_MODULE_RE);
    expect(ref.url).toBe(`${DOCUMENT_MODULE_PATH}/${ref.sha}.js`);
    expect(ref.bytes).toBe(19);
    expect(ref.imports).toEqual(['/islands/rt-abc.js']);
    expect(new TextDecoder().decode((await store.get(ref.sha))!)).toBe('export const a = 1;');
  });

  it('is idempotent: the same bytes are the same key, different bytes a different one', async () => {
    const store = createModuleStore();
    const a = await store.put(bytes('export const a = 1;'), []);
    const b = await store.put(bytes('export const a = 1;'), []);
    const c = await store.put(bytes('export const a = 2;'), []);
    expect(a.sha).toBe(b.sha);
    expect(c.sha).not.toBe(a.sha);
  });

  it('answers null for a sha it never wrote, and never for a malformed one', async () => {
    const store = createModuleStore();
    expect(await store.get('0123456789abcdef')).toBeNull();
    await expect(store.get('../etc/passwd')).resolves.toBeNull();
  });
});
