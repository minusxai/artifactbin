/* @jsxImportSource solid-js */
/**
 * The local document's hosted title read (solid/pages/LocalDocument) goes through the shared retry, held to the same
 * contract as every other read (lib/http/__tests__/retrying-read). Its own file: the broker and session are mocked.
 */
import { render } from 'solid-js/web';
import { MemoryRouter, Route } from '@solidjs/router';
import { vi } from 'vitest';
import type { LocalBrokerOptions } from '@/lib/local-connection/broker';
import { describeRetryingRead } from '@/solid/__tests__/retrying-read';
import { LocalDocumentPage } from '../LocalDocument';

const captured = vi.hoisted(() => ({ options: null as LocalBrokerOptions | null }));
vi.mock('../../lib/session', () => ({ useSession: () => ({ session: () => ({ kind: 'none' }) }) }));
vi.mock('../../editor/create-live-artifact', () => ({ createLiveArtifact: () => () => null }));
vi.mock('../../document/AnnotationLayer', () => ({ AnnotationLayer: () => null }));
vi.mock('@/lib/local-connection/broker', () => ({ installLocalConnectionBroker(options: LocalBrokerOptions) {
  captured.options = options;
  return { sourceChanged: vi.fn(), authorize: vi.fn(), signIn: vi.fn(), resize: vi.fn(), post: vi.fn(), disconnect: vi.fn(), retry: vi.fn(), dispose: vi.fn() };
} }));

const identity = { platformOrigin: 'https://platform.example', artifactId: 'p', baseRevision: '1', sourceDigest: 'a'.repeat(64) };
let unmount: (() => void) | null = null;
let container: HTMLElement | null = null;
describeRetryingRead('the local document\'s hosted title', () => ({
  start: () => {
    unmount?.(); container?.remove();
    container = document.body.appendChild(document.createElement('div'));
    unmount = render(() => <MemoryRouter><Route path="/" component={LocalDocumentPage} /></MemoryRouter>, container);
    captured.options!.onState('connected');
    captured.options!.onConnected?.({ identity, role: 'viewer', readOnly: true });
  },
  landed: () => (container?.textContent ?? '').includes('Hosted title'),
}), { matches: (url, init) => url === '/api/page/artifact/p' && init?.credentials === 'omit', ok: () => Response.json({ surface: { title: 'Hosted title' } }), otherwise: () => Response.json({}) });
