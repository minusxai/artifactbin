import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { mountStory, type MountedStory } from '../mount';
import { STORY_DOCUMENT_MESSAGE } from '../contract';

const nodes = (source: string) => {
  const parsed = parseJsx(source);
  if (!parsed.ok) throw new Error('invalid fixture');
  return parsed.nodes;
};
let mounted: MountedStory | undefined;
afterEach(async () => { await act(async () => { mounted?.dispose(); }); mounted = undefined; document.body.replaceChildren(); });

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
});
