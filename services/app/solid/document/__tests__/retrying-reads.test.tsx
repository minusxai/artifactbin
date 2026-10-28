/* @jsxImportSource solid-js */
/**
 * The document controls' own reads (people, invite lookup, sharing, the offline file) go through the shared retry
 * (lib/http/retry-lazily), each held to the contract in lib/http/__tests__/retrying-read: 502/503/504 and a dropped
 * connection are asked again, a 4xx is not, and a read that carries an AbortSignal stops when its panel unmounts.
 */
import { afterEach, vi } from 'vitest';
import { fireEvent, getQueriesForElement } from '@testing-library/dom';
import { render } from 'solid-js/web';
import type { JSX } from 'solid-js';
import { describeRetryingRead } from '@/lib/http/__tests__/retrying-read';
import { resetShared } from '@/lib/http/shared-request';
import { DocumentPeople } from '../DocumentPeople';
import { DocumentSharing } from '../DocumentSharing';
import { DownloadOffline } from '../DownloadOffline';
import ShareLink from '../../components/ShareLink';

const tick = () => new Promise<void>((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; channel.port2.postMessage(0); });
async function until<T>(find: () => T | null | undefined): Promise<T> {
  for (let i = 0; i < 200; i++) { const found = find(); if (found) return found; await tick(); }
  throw new Error('never appeared');
}

/** One mount at a time: each start() unmounts the previous one. */
let unmount: (() => void) | null = null;
let container: HTMLElement | null = null;
function mount(ui: () => JSX.Element) {
  unmount?.(); container?.remove();
  container = document.body.appendChild(document.createElement('div'));
  const dispose = render(ui, container);
  unmount = () => { dispose(); unmount = null; };
  return getQueriesForElement(container);
}
afterEach(() => { unmount?.(); container?.remove(); container = null; resetShared(); });

const members = { members: [], pending: [], self: null, canManage: false, canInvite: true };

describeRetryingRead('the people panel\'s members read', () => ({
  start: () => { resetShared(); mount(() => <DocumentPeople id="doc1" initialOpen />); },
  landed: () => !!container?.querySelector('[role="combobox"]'),
}), { matches: (url) => url === '/api/my/artifacts/doc1/members', ok: () => Response.json(members) });

describeRetryingRead('the invite lookup', () => ({
  start: async () => {
    resetShared();
    const view = mount(() => <DocumentPeople id="doc1" initialOpen />);
    const finder = await until(() => view.queryByRole('combobox', { name: 'Find people by username' }));
    fireEvent.focusIn(finder); (finder as HTMLElement).focus(); fireEvent.click(finder);
    return { abort: () => unmount?.() };
  },
  landed: () => !!document.body.textContent?.includes('@alex'),
}), {
  matches: (url) => url.startsWith('/api/my/artifacts/doc1/members?purpose=invite'),
  ok: () => Response.json({ people: [{ user_id: 'u1', username: 'alex', name: 'Alex' }] }),
  otherwise: () => Response.json(members),
  abortable: true,
});

const sharing = { visibility: 'public', linkRole: 'viewer', shares: [{ email: 'one@example.com', role: 'viewer' }], canPrivate: true };

describeRetryingRead('the document sharing read', () => ({
  start: () => { mount(() => <DocumentSharing id="doc1" title="Report" owner />); return { abort: () => unmount?.() }; },
  landed: () => !!container?.querySelector('button')?.textContent?.includes('public'),
}), { matches: (url) => url === '/api/my/artifacts/doc1/sharing', ok: () => Response.json(sharing), abortable: true });

describeRetryingRead('the share link\'s sharing read', () => ({
  start: () => { mount(() => <ShareLink artifactId="doc1" title="Plan" format="markup" editable startOpen />); },
  landed: () => !!document.querySelector('[aria-label="Role for one@example.com"]'),
}), { matches: (url) => url === '/api/my/artifacts/doc1/sharing', ok: () => Response.json(sharing) });

{
  const made = vi.fn();
  describeRetryingRead('the offline download', () => ({
    start: () => {
      made.mockClear();
      Object.assign(URL, { createObjectURL: () => { made(); return 'blob:offline'; }, revokeObjectURL: () => {} });
      const view = mount(() => <DownloadOffline id="doc1" />);
      fireEvent.click(view.getByRole('link', { name: 'Download for offline' }));
    },
    landed: () => made.mock.calls.length > 0,
  }), { matches: (url) => url === '/a/doc1/download', ok: () => new Response('<!doctype html>', { headers: { 'Content-Type': 'text/html' } }) });
}
