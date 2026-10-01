/**
 * THE PUBLIC PAGE API'S ONE INSTALLER (lib/islands/mx-host `installPublicMx`): page.ts (on `mx:ready`) and
 * boot.ts (back to reading) both install `window.mx` through it, and boot removes it through the
 * uninstaller it leaves on the story root under `PUBLIC_MX_KEY`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { installPublicMx } from '../mx-host';
import { PUBLIC_MX_KEY, type PublicMxHost } from '../contract';
import { createDataflowStore } from '@/lib/story-runtime/store';
import type { CompiledDataflow } from '@/lib/story/data/compiled-dataflow';

const flow: CompiledDataflow = { imports: [], mutations: [], queries: [], values: [{ name: 'region', kind: 'scalar', type: 'string', default: 'West' }] };
const root = () => document.createElement('div') as PublicMxHost;

afterEach(() => { delete window.mx; });

describe('installPublicMx', () => {
  it('installs window.mx over the store and leaves its uninstaller on the root', async () => {
    const host = root();
    const store = createDataflowStore({ flow });
    const uninstall = installPublicMx(host, store, window, () => true);
    expect(window.mx).toBeDefined();
    expect((await window.mx!.read(['region'])).signals.region!.value).toBe('West');
    expect(host[PUBLIC_MX_KEY]).toBe(uninstall);
    uninstall();
    expect(window.mx).toBeUndefined();
    expect(host[PUBLIC_MX_KEY]).toBeUndefined();
  });

  it('replaces an earlier install on the same root', () => {
    const host = root();
    const uninstallFirst = installPublicMx(host, createDataflowStore({ flow }), window, () => true);
    const first = window.mx;
    const second = installPublicMx(host, createDataflowStore({ flow }), window, () => true);
    expect(window.mx).toBeDefined();
    expect(window.mx, 'the newer store\'s API').not.toBe(first);
    expect(host[PUBLIC_MX_KEY]).toBe(second);
    const current = window.mx;
    uninstallFirst();
    expect(window.mx, 'the replaced uninstaller no longer owns the page API').toBe(current);
    expect(host[PUBLIC_MX_KEY]).toBe(second);
  });

  it('leaves a newer page API alone when an older uninstaller runs', () => {
    const host = root();
    const uninstall = installPublicMx(host, createDataflowStore({ flow }), window, () => true);
    const other = installPublicMx(root(), createDataflowStore({ flow }), window, () => true);
    const newer = window.mx;
    uninstall();
    expect(window.mx).toBe(newer);
    other();
  });

  it('installs nothing when the document is no longer reading or its store was disposed', () => {
    const host = root();
    installPublicMx(host, createDataflowStore({ flow }), window, () => false)();
    expect(window.mx).toBeUndefined();
    expect(host[PUBLIC_MX_KEY]).toBeUndefined();
    const store = createDataflowStore({ flow });
    store.dispose();
    installPublicMx(host, store, window, () => true)();
    expect(window.mx).toBeUndefined();
    expect(host[PUBLIC_MX_KEY]).toBeUndefined();
  });
});
