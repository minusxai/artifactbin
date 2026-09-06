import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAuthorScriptSession, startAuthorScript } from '../author-script';
import { createDataflowStore } from '../store';
import { AUTHOR_SCRIPT_FRAME_TITLE } from '../author-script-contract';

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
describe('isolated author script host', () => {
  it('preserves unchanged code, replaces changed code, and revokes removed code', () => {
    const store = createDataflowStore({ flow: { values: [], queries: [] } });
    const session = createAuthorScriptSession(store);
    session.replace('void 1');
    const first = document.querySelector('iframe');
    session.replace('void 1');
    expect(document.querySelector('iframe')).toBe(first);
    session.replace('void 2');
    expect(document.querySelector('iframe')).not.toBe(first);
    expect(first?.isConnected).toBe(false);
    expect(document.querySelectorAll('iframe')).toHaveLength(1);
    session.replace(null);
    expect(document.querySelector('iframe')).toBeNull();
    session.dispose();
    session.replace('void 3');
    expect(document.querySelector('iframe')).toBeNull();
  });
  it('creates only an opaque, hidden script frame; never executes in the document realm', () => {
    const store = createDataflowStore({ flow: { values: [], queries: [] } });
    const cleanup = startAuthorScript('window.__authorEscaped = true', store);
    const frame = document.querySelector('iframe')!;
    expect(frame.title).toBe(AUTHOR_SCRIPT_FRAME_TITLE);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.hidden).toBe(true);
    expect(document.querySelector('script')).toBeNull();
    expect((window as unknown as { __authorEscaped?: boolean }).__authorEscaped).toBeUndefined();
    expect(frame.srcdoc).toContain("default-src 'none'");
    expect(frame.srcdoc).toContain("connect-src 'none'");
    expect(frame.srcdoc).toContain("form-action 'none'");
    cleanup();
    expect(document.querySelector('iframe')).toBeNull();
  });
});
