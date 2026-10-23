import { describe, expect, it } from 'vitest';
import { createStylesheetStore, STYLESHEET_PATH } from '../modules.server';

describe('shared stylesheet store', () => {
  it('stores one immutable, content-addressed stylesheet per text and refuses unknown or malformed keys', async () => {
    const store = createStylesheetStore();
    const css = '.shared{color:red}\n.more{margin:0}';
    const a = await store.put(css);
    const b = await store.put(css);
    expect(a).toBe(b);
    expect(a).toMatch(new RegExp(`^${STYLESHEET_PATH}/[0-9a-f]{16}\\.css$`));
    expect(new TextDecoder().decode((await store.get(a.slice(-20, -4)))!)).toBe(css);
    expect(await store.put('.other{color:blue}')).not.toBe(a);
    await expect(store.get('../secrets')).resolves.toBeNull();
    await expect(store.get('0123456789abcdef')).resolves.toBeNull();
  });
});
