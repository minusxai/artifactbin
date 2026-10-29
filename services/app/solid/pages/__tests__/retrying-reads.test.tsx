/* @jsxImportSource solid-js */
/**
 * The pages' own reads (a folder's and a dataset's live re-read, the welcome profile, the dataset rules, the account's
 * email and domain settings, the inbox) go through the shared retry (lib/http/retry-lazily), each held to the same
 * contract (lib/http/__tests__/retrying-read): 502/503/504 and a dropped connection are asked again, a 4xx is not,
 * and a read that carries an AbortSignal stops when it aborts.
 */
import { createRoot, type JSX } from 'solid-js';
import { render } from 'solid-js/web';
import { MemoryRouter, Route, Router } from '@solidjs/router';
import { vi } from 'vitest';
import { describeRetryingRead } from '@/solid/__tests__/retrying-read';
import { STORY_DATA_EVENT } from '@/lib/story-runtime/contract';
import type { FolderPage as FolderData } from '@/lib/workspace';
import type { DatasetCatalog } from '@/lib/datasets';
import { FolderPage } from '@/solid/pages/Folder';
import { ArtifactDataPage, type DataAnswer } from '@/solid/pages/ArtifactData';
import { WelcomePage } from '@/solid/pages/Welcome';
import { DatasetActionsView } from '@/solid/datasets/DatasetActionsView';
import { DatasetPolicies } from '@/solid/datasets/DatasetPolicies';
import { NotificationSettings } from '@/solid/account/NotificationSettings';
import { CustomDomainCard } from '@/solid/account/CustomDomainCard';
import { InboxProvider } from '@/solid/lib/notifications';
import { createInboxController } from '@/solid/lib/create-inbox';

const ok = (body: unknown) => () => Response.json(body);
const realTick = () => new Promise<void>((resolve) => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); resolve(); }; channel.port2.postMessage(0); });
async function until(condition: () => boolean, ticks = 200) { for (let i = 0; i < ticks && !condition(); i++) await realTick(); if (!condition()) throw new Error('never happened'); }

/** One mounted UI at a time: each start unmounts the last. */
let unmount: (() => void) | null = null;
let container: HTMLElement | null = null;
function mount(ui: () => JSX.Element) {
  unmount?.(); container?.remove();
  const target = container = document.body.appendChild(document.createElement('div'));
  const dispose = render(ui, target);
  unmount = () => { dispose(); target.remove(); if (container === target) { container = null; unmount = null; } };
  return { abort: () => unmount?.() };
}
const text = () => container?.textContent ?? '';

/** A live stream the test can deliver to: `onmessage` frames and named events. */
const streams: FakeEventSource[] = [];
class FakeEventSource {
  url: string; onmessage: ((event: { data: string }) => void) | null = null; onerror: unknown = null; onopen: unknown = null;
  listeners = new Map<string, Array<(event: { data: string }) => void>>();
  constructor(url: string) { this.url = url; streams.push(this); }
  addEventListener(type: string, listener: (event: { data: string }) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  removeEventListener() {}
  close() {}
  emit(type: string, data: string) { for (const listener of this.listeners.get(type) ?? []) listener({ data }); }
}
const withStreams = () => { streams.length = 0; vi.stubGlobal('EventSource', FakeEventSource); };

{
  const folder = { id: 'fold01', title: 'Reports', trail: [], count: { documents: 0, folders: 0 }, rows: [] } as unknown as FolderData;
  describeRetryingRead('the folder\'s live re-read', () => ({
    start: async () => {
      withStreams();
      mount(() => <MemoryRouter><Route path="*" component={() => <FolderPage folder={folder} role="viewer" />} /></MemoryRouter>);
      await until(() => streams.some((stream) => stream.url === '/a/fold01/events'));
      streams.find((stream) => stream.url === '/a/fold01/events')!.emit(STORY_DATA_EVENT, '{}');
    },
    landed: () => text().includes('Quarterly'),
  }), { matches: (url) => url === '/api/page/artifact/fold01', ok: ok({ folder: { ...folder, title: 'Quarterly' } }) });
}

{
  const catalog = (name: string) => ({ kind: 'stored', defaultSchema: 'public', refreshSeconds: 0, tables: [{ schema: 'public', name, columns: [{ name: 'region', type: 'string' }] }] }) as unknown as DatasetCatalog;
  const data: DataAnswer = { role: 'viewer', kind: 'none', surface: { id: 'art001', editId: 'e1', format: 'dataset', title: 'Regional sales', visibility: 'public', version: 1, source: null, dataPreview: '', columns: [], catalog: catalog('rows') } } as unknown as DataAnswer;
  describeRetryingRead('the dataset page\'s live catalog re-read', () => ({
    start: async () => {
      withStreams();
      window.history.replaceState(null, '', '/a/art001');
      mount(() => <InboxProvider><Router><Route path="/a/:id" component={() => <ArtifactDataPage answer={data} />} /></Router></InboxProvider>);
      await until(() => streams.some((stream) => stream.url === '/a/art001/events'));
      streams.find((stream) => stream.url === '/a/art001/events')!.onmessage?.({ data: JSON.stringify({ editId: 'e2', version: 2, by: null }) });
    },
    landed: () => text().includes('orders'),
  }), {
    matches: (url) => url === '/api/page/artifact/art001', ok: ok({ surface: { version: 2, catalog: catalog('orders') } }),
    otherwise: (url) => {
      if (url.endsWith('/events/frame')) return Response.json({ editId: 'e2', version: 2, by: null, format: 'dataset', title: 'Regional sales', source: null, dataPreview: null });
      if (url.endsWith('/tables')) return Response.json({ rows: [], columns: [{ name: 'region', type: 'string' }], refreshedAt: '2026-09-30T00:00:00.000Z' });
      return Response.json({});
    },
  });
}

describeRetryingRead('the welcome page\'s profile read', () => ({
  start: () => { mount(() => <MemoryRouter><Route path="*" component={WelcomePage} /></MemoryRouter>); },
  landed: () => (container?.querySelector<HTMLInputElement>('input[aria-label="Username"]')?.value ?? '') === 'chosen',
}), { matches: (url) => url === '/api/my/profile', ok: ok({ username: 'chosen', image: null }) });

describeRetryingRead('the dataset\'s read-only data actions', () => ({
  start: () => mount(() => <DatasetActionsView id="ds123" canInspect />),
  landed: () => text().includes('No data action rules are configured.'),
}), { matches: (url) => url === '/api/my/artifacts/ds123/policy', ok: ok({ policy: null, writtenBy: [] }), abortable: true });

describeRetryingRead('the dataset access policies', () => ({
  start: () => { mount(() => <DatasetPolicies artifactId="ds123" expanded />); },
  landed: () => text().includes('Allow insert'),
}), { matches: (url) => url === '/api/my/artifacts/ds123/policy', ok: ok({ policy: null, revision: 0, tables: [{ schema: 'public', name: 'rows', columns: [{ name: 'branch', type: 'string' }] }], writtenBy: [] }) });

describeRetryingRead('the email notification settings', () => ({
  start: () => { mount(() => <InboxProvider><NotificationSettings /></InboxProvider>); },
  landed: () => text().includes('Unread comment updates'),
}), { matches: (url) => url === '/api/my/people/email', ok: ok({ enabled: true, preferences: { invitations: true, comments: true, activity: false } }) });

describeRetryingRead('the custom domain settings', () => ({
  start: () => { mount(() => <CustomDomainCard />); },
  landed: () => !!container?.querySelector('[aria-label="Add custom domain"]'),
}), { matches: (url, init) => url === '/api/my/domain' && (init?.method ?? 'GET') === 'GET', ok: ok({ enabled: true, target: 'pages.test', targetAddresses: [], domain: null }) });

{
  let inbox: { state: () => unknown; dispose: () => void } | null = null;
  const start = () => { inbox?.dispose(); inbox = createRoot((dispose) => ({ state: createInboxController(() => 'u1').state, dispose })); };
  describeRetryingRead('the inbox read', () => ({ start, landed: () => inbox?.state() != null }), {
    matches: (url) => url === '/api/my/people', ok: ok({ notifications: [], blocks: [], next: null }),
  });
  describeRetryingRead('the inbox\'s next page', () => ({ start, landed: () => inbox?.state() != null }), {
    matches: (url) => url === '/api/my/people?offset=1', ok: ok({ notifications: [], blocks: [], next: null }),
    otherwise: (url) => url === '/api/my/people' ? Response.json({ notifications: [], blocks: [], next: 1 }) : Response.json({}, { status: 404 }),
  });
}
