/* @jsxImportSource solid-js */
import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import { BoundImage, rowImageAttrs } from '../kit/files';
import { rowAttrs } from '../kit/basic';
import type { IslandContext } from '../contract';

describe('compiled bound image', () => {
  it('resolves row image references after substituting the row field', () => {
    expect(rowImageAttrs(rowAttrs({ src: '$_row.cover_ref', alt: '$_row.label', loading: 'lazy' }, { cover_ref: 'ref:Abc123', label: 'Cover' }))).toEqual({ src: '/a/Abc123/raw', alt: 'Cover', loading: 'lazy' });
  });
  it('imports a reader-chosen URL through the document door and paints only the mapped URL', async () => {
    const data = document.createElement('script');
    data.id = 'mx-story-data';
    data.type = 'application/json';
    data.textContent = JSON.stringify({ assetsUrl: '/a/Doc123/assets' });
    document.body.append(data);
    const [pick, setPick] = createSignal('https://images.example/a.png');
    let resolve!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>(done => { resolve = done; }));
    vi.stubGlobal('fetch', fetcher);
    const island = { ...fakeIsland(), values: () => ({ pick: pick() }), value: (name: string) => name === 'pick' ? pick() : undefined } as IslandContext;
    const host = document.createElement('div');
    const dispose = render(() => <IslandProvider value={island}><BoundImage template="$pick" props={{ alt: 'chosen' }} /></IslandProvider>, host);
    expect(host.querySelector('img')?.hasAttribute('src')).toBe(false);
    expect(fetcher).toHaveBeenCalledWith('/a/Doc123/assets?u=https%3A%2F%2Fimages.example%2Fa.png', expect.objectContaining({ headers: { Accept: 'application/json' } }));
    resolve(new Response(JSON.stringify({ url: '/assets/cached' }), { status: 200 }));
    await vi.waitFor(() => expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/cached'));
    setPick('javascript:alert(1)');
    expect(host.querySelector('img')?.hasAttribute('src')).toBe(false);
    expect(host.querySelector('img')?.getAttribute('data-mx-asset')).toBe('refused');
    expect(fetcher).toHaveBeenCalledTimes(1);
    setPick('https://images.example/a.png');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('/assets/cached');
    expect(fetcher, 'returning to an imported value reuses its mapped URL').toHaveBeenCalledTimes(1);
    dispose(); data.remove(); vi.unstubAllGlobals();
  });
});
