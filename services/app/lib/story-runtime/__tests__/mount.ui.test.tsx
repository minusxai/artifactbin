import { act, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { mountStory, type MountedStory } from '../mount';
import { STORY_ADOPT_HOOK, STORY_EDIT_MODE_MESSAGE, STORY_DOCUMENT_MESSAGE } from '../contract';

const nodes = (source: string) => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error('invalid fixture');
  return parsed.nodes;
};
let mounted: MountedStory | undefined;
afterEach(async () => { await act(async () => { mounted?.dispose(); }); mounted = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('reusable story runtime lifecycle', () => {
  it('renders into the explicit top-level host, adopts updates and disposes', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    await act(async () => {
      mounted = mountStory({ root: host, peerOrigin: window.location.origin, renderMode: 'render',
        data: { nodes: nodes('<p id="first">First route</p>'), refData: {}, colorMode: 'light', chrome: false } });
    });
    expect(host.textContent).toContain('First route');
    expect(host.querySelector('iframe')).toBeNull();
    await act(async () => mounted!.adopt({ type: STORY_DOCUMENT_MESSAGE, nodes: nodes('<p id="first">Updated route</p>') }));
    expect(host.textContent).toContain('Updated route');
    await act(async () => mounted!.dispose());
    expect(host.textContent).toBe('');
  });

  it('does not select an author-created root ID instead of its explicit host', async () => {
    const decoy = document.createElement('div');
    decoy.id = 'mx-story-root';
    decoy.textContent = 'Not the host';
    const host = document.createElement('div');
    document.body.append(decoy, host);
    await act(async () => { mounted = mountStory({ root: host, peerOrigin: window.location.origin, renderMode: 'render',
      data: { nodes: nodes('<p>Actual host</p>'), refData: {}, colorMode: 'light', chrome: false } }); });
    expect(decoy.textContent).toBe('Not the host');
    expect(host.textContent).toBe('Actual host');
  });

  it('removes owned hooks and ignores late adoption after disposal', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    mounted = mountStory({ root: host, peerOrigin: window.location.origin, renderMode: 'render',
      data: { nodes: nodes('<p>Mounted</p>'), refData: {}, colorMode: 'light', chrome: false } });
    expect((window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK]).toBe(mounted.adopt);
    mounted.dispose();
    expect((window as unknown as Record<string, unknown>)[STORY_ADOPT_HOOK]).toBeUndefined();
    mounted.adopt({ type: STORY_DOCUMENT_MESSAGE, nodes: nodes('<p>Too late</p>') });
    expect(host.textContent).toBe('');
  });

  it('owns and revokes the isolated author-script frame', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    await act(async () => { mounted = mountStory({ root: host, peerOrigin: window.location.origin, renderMode: 'render',
      authorScript: 'mx.params.get("anything")',
      data: { nodes: nodes('<p>Mounted</p>'), refData: {}, colorMode: 'light', chrome: false } }); });
    expect(document.querySelector('iframe[title="Isolated artifact script"]')).not.toBeNull();
    await act(async () => mounted!.dispose());
    expect(document.querySelector('iframe[title="Isolated artifact script"]')).toBeNull();
  });

  it('removes only styles it owns', async () => {
    const existing = document.createElement('style');
    existing.setAttribute('data-mx-author', 'decoy');
    document.head.append(existing);
    const host = document.createElement('div'); document.body.append(host);
    mounted = mountStory({ root: host, peerOrigin: window.location.origin, renderMode: 'render',
      data: { nodes: nodes('<p>Mounted</p>'), refData: {}, colorMode: 'light', chrome: false } });
    mounted.adopt({ type: STORY_DOCUMENT_MESSAGE, nodes: nodes('<p>Updated</p>'), authorCss: 'p{color:red}' });
    expect(document.head.querySelectorAll('style[data-mx-author]')).toHaveLength(2);
    mounted.dispose();
    expect(document.head.querySelectorAll('style[data-mx-author]')).toHaveLength(1);
    expect(document.head.querySelector('style[data-mx-author]')).toBe(existing);
    existing.remove();
  });

  it('adopts into the builder styles it owns during legacy hydration', async () => {
    const compiled = document.createElement('style'); compiled.setAttribute('data-mx-tw', ''); compiled.textContent = '.old{}';
    const author = document.createElement('style'); author.setAttribute('data-mx-author', ''); author.textContent = '.author{}';
    document.head.append(compiled, author);
    const host = document.createElement('div'); host.innerHTML = '<div class="mx-doc"><p id="first" data-mx-ast="0">First</p></div>'; document.body.append(host);
    await act(async () => { mounted = mountStory({ root: host, peerOrigin: window.location.origin, renderMode: 'hydrate',
      data: { nodes: nodes('<p id="first">First</p>'), refData: {}, colorMode: 'light', chrome: false } }); });
    mounted.adopt({ type: STORY_DOCUMENT_MESSAGE, nodes: nodes('<p id="first">Second</p>'), compiledCss: '.new{}', authorCss: '.new-author{}' });
    expect(document.head.querySelectorAll('style[data-mx-tw]')).toHaveLength(1);
    expect(compiled.textContent).toBe('.new{}');
    expect(author.textContent).toBe('.new-author{}');
  });

  it('accepts edit commands from an explicit trusted same-window peer and tears the session down', async () => {
    const added: EventListener[] = [];
    const original = window.addEventListener.bind(window);
    const spy = vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === 'message' && typeof listener === 'function') added.push(listener);
      original(type, listener, options);
    }) as Window['addEventListener']);
    const host = document.createElement('div'); document.body.append(host);
    mounted = mountStory({ root: host, peer: window, peerOrigin: window.location.origin, renderMode: 'render',
      data: { nodes: nodes('<p id="editable">Edit me</p>'), refData: {}, colorMode: 'light', chrome: false } });
    const command = (on: boolean) => ({ isTrusted: true, source: window, origin: window.location.origin,
      data: { type: STORY_EDIT_MODE_MESSAGE, on } } as MessageEvent);
    await act(async () => { for (const listener of added) listener(command(true)); });
    await waitFor(() => expect(host.querySelector('[contenteditable="true"]')).not.toBeNull());
    await act(async () => { for (const listener of added) listener(command(false)); });
    expect(host.querySelector('[contenteditable="true"]')).toBeNull();
    spy.mockRestore();
  });
});
