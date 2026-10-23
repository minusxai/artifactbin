import { describe, expect, it } from 'vitest';
import { createTemplateResourceStore } from '../modules.server';

describe('compiled island template resource', () => {
  it('stores one immutable, content-addressed JSON resource and refuses unknown keys', async () => {
    const store = createTemplateResourceStore();
    const templates = { a: '<p>hello</p>', b: '<span>later</span>' };
    const a = await store.put(templates);
    const b = await store.put(templates);
    expect(a).toBe(b);
    expect(a).toMatch(/^\/islands\/t\/[0-9a-f]{16}\.json$/);
    expect(JSON.parse(new TextDecoder().decode((await store.get(a.slice(-21, -5)))!))).toEqual(templates);
    await expect(store.get('../secrets')).resolves.toBeNull();
  });
});
