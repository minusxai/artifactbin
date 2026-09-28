/* @jsxImportSource solid-js */
/**
 * THE LINK FOLLOWS THE READER ON A COMPILED PAGE (lib/islands/boot + lib/islands/url-sync, today's
 * lib/story-runtime/url-values-sync): a top-level page rewrites its own address when a `<Value>` moves —
 * its `$` params only (never a `url={false}` draft), the other params and the hash kept, the old
 * selection replaced rather than a history entry pushed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compiledOf } from '@/test/helpers/compiled';
import { boot } from '../boot';
import { useIsland } from '../context';
import type { IslandDocument } from '../contract';

const FLOW = await compiledOf('<Value name="region" type="string" /><Value name="draft" type="string" url={false} />');
function Region() { const island = useIsland(); return <div id="island">{String(island.value('region'))}</div>; }

const page = (values: Record<string, unknown>) => {
  document.body.innerHTML = '<div data-mx-inline-story="" id="mx-story-root"><div data-hk="s0-0" id="island">…</div></div>'
    + `<script type="application/json" id="mx-story-data">${JSON.stringify({ values, results: null, signedIn: false, hold: [], mermaidImages: {}, readOnly: null })}</script>`;
};

let booted: IslandDocument | null = null;
const start = window.location.href;
afterEach(() => { booted?.dispose(); booted = null; window.history.replaceState(null, '', start); });

describe('the compiled page\'s address', () => {
  it('follows a value the reader moves, replacing the old selection and keeping the other params', async () => {
    window.history.replaceState(null, '', '/a/abc?$region=west&reader=compiled#top');
    const length = window.history.length;
    page({ region: 'west' });
    booted = boot({ ISLANDS: [['s0-', Region]], FLOW });
    booted.context.setValue('region', 'east');
    await vi.waitFor(() => expect(window.location.search).toContain('$region=east'));
    expect(window.location.search).not.toContain('west');
    expect(window.location.search).toContain('reader=compiled');
    expect(window.location.pathname).toBe('/a/abc');
    expect(window.location.hash).toBe('#top');
    expect(window.history.length, 'replaced, not pushed').toBe(length);

    booted.context.setValue('draft', 'secret');
    booted.context.setValue('region', null);
    await vi.waitFor(() => expect(window.location.search).not.toContain('region'));
    expect(window.location.search, 'a url={false} value never travels').not.toContain('secret');
  });
});
