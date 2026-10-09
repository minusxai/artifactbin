/* @jsxImportSource solid-js */
/**
 * The DATA TIERS' page (solid/pages/ArtifactData): an image, a pdf, a stored file, a viz recipe and a
 * dataset read as values inside the app's own measure, under the app bar with the artifact's title as
 * its crumb, Fork as the bar's action, and the "Artifact controls" panel (forked-from, the owner's
 * dataset reference and sharing). Same accessible names as components/ArtifactSurface's data branch.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@solidjs/testing-library';
import { Route, Router } from '@solidjs/router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InboxProvider } from '@/solid/lib/notifications';
import { ArtifactDataPage, type DataAnswer } from '@/solid/pages/ArtifactData';
import type { DatasetAccessPolicy } from '@artifactbin/contracts';
import type { DatasetCatalog } from '@/lib/datasets/types';
import { datasetQuerySnippet } from '@/lib/datasets/dataset-usage';

const streams: Array<{ url: string; onmessage: ((event: { data: string }) => void) | null; closed: boolean }> = [];
class FakeEventSource {
  url: string; onmessage: ((event: { data: string }) => void) | null = null; closed = false;
  constructor(url: string) { this.url = url; streams.push(this); }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
const catalog = (name = 'rows'): DatasetCatalog => ({ kind: 'stored', defaultSchema: 'public', refreshSeconds: 0, tables: [{ schema: 'public', name, columns: [{ name: 'region', type: 'string' }] }] } as unknown as DatasetCatalog);
let pageAnswers: unknown[] = [];
let policy: DatasetAccessPolicy | null;
beforeEach(() => {
  streams.length = 0; pageAnswers = [];
  policy = {version: 1, enforcement: 'enabled', tables: [{table: {schema: 'public', name: 'rows'}, insert_permissions: [{role: 'viewer', permission: {columns: '*', check: {}}}]}]};
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/tables')) return Response.json({ rows: [{ region: 'North' }], columns: [{ name: 'region', type: 'string' }], refreshedAt: '2026-09-30T00:00:00.000Z' });
    if (url.endsWith('/events/frame')) return Response.json({ editId: 'e2', version: 2, by: null, format: 'dataset', title: 'Regional sales', source: null, dataPreview: null });
    if (url.startsWith('/api/page/artifact/')) return Response.json(pageAnswers.shift() ?? {});
    if (url.endsWith('/policy')) return Response.json({policy, revision: 1, tables: [], writtenBy: []});
    if (url.endsWith('/sharing')) return Response.json({ visibility: 'public', linkRole: 'viewer', shares: [] });
    return Response.json({});
  }));
});
afterEach(() => { cleanup(); window.history.replaceState(null, '', '/'); vi.unstubAllGlobals(); });

const answer = (format: string, over: Partial<DataAnswer['surface']> = {}, role: DataAnswer['role'] = 'viewer'): DataAnswer => ({
  role, kind: role === 'owner' ? 'account' : 'none',
  surface: { id: 'art001', editId: 'e1', format, title: 'Regional sales', visibility: 'public', version: 1, source: null, dataPreview: '', columns: [], ...over },
});
const open = (data: DataAnswer) => {
  window.history.replaceState(null, '', `/a/${data.surface.id}`);
  return render(() => <InboxProvider><Router><Route path="/a/:id" component={() => <ArtifactDataPage answer={data} />} /></Router></InboxProvider>);
};
const controls = () => { fireEvent.click(screen.getByRole('button', { name: 'Open artifact controls' })); return within(screen.getByLabelText('Artifact controls')); };

it('draws an image from its raw address under the app bar, titled and forkable', () => {
  open(answer('image'));
  expect(screen.getByRole('img', { name: 'Regional sales' })).toHaveAttribute('src', '/a/art001/raw');
  expect(within(screen.getByLabelText('Page bar')).getByLabelText('Current page')).toHaveTextContent('Regional sales');
  expect(within(screen.getByLabelText('Page bar')).getByRole('button', { name: 'Fork artifact' })).toBeInTheDocument();
  expect(document.title).toBe('Regional sales');
});

it('summarizes a pdf and a stored file with the link that opens them', () => {
  open(answer('pdf', { bytes: 1100, pages: 3, title: 'Quarterly review' }));
  expect(screen.getByLabelText('PDF summary')).toHaveTextContent('PDF · 1.1 kB · 3 pages');
  const pdf = screen.getByRole('link', { name: 'Open the PDF' });
  expect(pdf).toHaveAttribute('href', '/a/art001/raw');
  expect(pdf).toHaveAttribute('target', '_blank');
  expect(pdf).toHaveTextContent('Open Quarterly review');
  cleanup();
  open(answer('file', { bytes: 12, pages: null, title: 'notes' }));
  expect(screen.getByLabelText('File summary')).toHaveTextContent('File · 12 bytes');
  expect(screen.getByRole('link', { name: 'Download file' })).toHaveTextContent('Download notes');
});

it('opens a stored file in the viewer its extension picks, reading the bytes from its raw address', async () => {
  open(answer('pdf', { bytes: 1100, pages: 3, title: 'Quarterly review' }));
  expect(screen.getByTitle('Quarterly review.pdf')).toHaveAttribute('src', '/a/art001/raw');
  cleanup();
  open(answer('file', { bytes: 120, filename: 'clip.mp4', title: 'clip' }));
  expect(screen.getByLabelText('clip.mp4').tagName).toBe('VIDEO');
  expect(screen.getByLabelText('clip.mp4')).toHaveAttribute('src', '/a/art001/raw');
  cleanup();
  vi.mocked(fetch).mockImplementation(async (input) => new Response(String(input) === '/a/art001/raw' ? 'month,revenue\n2026-01,120' : '{}'));
  open(answer('file', { bytes: 24, filename: 'sales.csv', title: 'sales' }));
  expect(await screen.findByText(/month,revenue/)).toHaveAccessibleName('Preview of sales.csv');
  cleanup();
  open(answer('file', { bytes: 12, filename: 'bundle.zip', title: 'bundle' }));
  expect(screen.getByLabelText('File summary')).toBeInTheDocument();
  expect(screen.queryByLabelText('File summary of bundle.zip')).not.toBeInTheDocument();
});

it('shows a viz recipe as its source and a legacy dataset as a bounded table with missing cells marked', () => {
  open(answer('viz', { dataPreview: '{"mark":"bar"}' }));
  expect(screen.getByText('{"mark":"bar"}').tagName).toBe('PRE');
  cleanup();
  open(answer('dataset', { dataPreview: JSON.stringify([{ month: '2026-01', revenue: 120 }, { month: '2026-02', revenue: null }]), columns: [{ name: 'month', type: 'string' }, { name: 'revenue', type: 'number' }] }));
  expect(screen.getByLabelText('Dataset summary')).toHaveTextContent('2 rows · 2 columns');
  const table = screen.getByRole('table');
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(table).toHaveTextContent('—');
});

it('explores a catalogued dataset, and the owner may edit it and copy its reference', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  open(answer('dataset', { catalog: catalog() }, 'owner'));
  await waitFor(() => expect(screen.getByLabelText('Dataset catalog')).toBeInTheDocument());
  expect(screen.getByLabelText('Edit dataset')).toBeInTheDocument();
  const panel = controls();
  fireEvent.click(panel.getByRole('button', { name: 'Copy dataset reference' }));
  expect(writeText).toHaveBeenCalledWith(datasetQuerySnippet('art001', catalog()));
  expect(panel.getByRole('button', { name: 'Copy dataset reference' })).toHaveTextContent('copied dataset reference');
  expect(within(panel.getByLabelText('Owner actions')).queryByRole('button', { name: 'Share' })).toBeNull();
});

it('keeps the owner affordances from readers and hands an editor sharing without ownership', () => {
  open(answer('image', { author: { username: 'cee', forkedFrom: { label: '@bob/original', href: '/a/orig01' } } }));
  let panel = controls();
  expect(panel.getByRole('link', { name: 'Open the artifact this was forked from' })).toHaveAttribute('href', '/a/orig01');
  expect(panel.queryByLabelText('Owner actions')).toBeNull();
  expect(panel.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(panel.getByRole('group', { name: 'Color mode' })).toBeInTheDocument();
  cleanup();
  open(answer('dataset', { catalog: catalog() }, 'editor'));
  panel = controls();
  expect(panel.queryByLabelText('Owner actions')).toBeNull();
  expect(panel.queryByRole('button', { name: 'Copy dataset reference' })).toBeNull();
  expect(panel.queryByRole('button', { name: 'Share' })).toBeNull();
  expect(screen.getByRole('tab', {name: 'Sharing'})).toBeInTheDocument();
});

it('follows a dataset on its live stream: a new version re-reads the page and adopts its catalog', async () => {
  pageAnswers.push({ surface: { version: 2, catalog: catalog('orders') } });
  open(answer('dataset', { catalog: catalog('rows') }));
  await waitFor(() => expect(streams.some((stream) => stream.url === '/a/art001/events')).toBe(true));
  const stream = streams.find((candidate) => candidate.url === '/a/art001/events')!;
  stream.onmessage?.({ data: JSON.stringify({ editId: 'e2', version: 2, by: null }) });
  await waitFor(() => expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some(([url]) => url === '/api/page/artifact/art001')).toBe(true));
  await waitFor(() => expect(within(screen.getByLabelText('Dataset table')).getByRole('option', { name: 'orders' })).toBeInTheDocument());
});

it('photographs a capture without opening a live stream, its image read with the capture key', () => {
  open(answer('image', { captureKey: '123.abc' }));
  const image = screen.getByRole('img', { name: 'Regional sales' });
  expect(screen.getByRole('main')).toContainElement(image);
  expect(image).toHaveAttribute('src', '/a/art001/raw?key=123.abc');
  expect(streams).toHaveLength(0);
});

it('gives dataset viewers the workspace layout with read-only data tabs and sharing', async () => {
  open(answer('dataset', { catalog: catalog() }, 'owner'));
  expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Regional sales', level: 1 })).toBeNull();
  expect(within(screen.getByLabelText('Page bar')).getByLabelText('Current page')).toHaveTextContent('Regional sales');
  const tabs = within(screen.getByRole('tablist', { name: 'Dataset workspace' }));
  expect(tabs.getAllByRole('tab').map(button => button.textContent)).toEqual(['Data preview', 'Data actions', 'Sharing']);
  expect(tabs.getByRole('tab', { name: 'Data preview' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getAllByRole('link', { name: 'Edit dataset' })).toHaveLength(1);
  fireEvent.click(tabs.getByRole('tab', { name: 'Data actions' }));
  expect(await screen.findByLabelText('Read-only data actions')).toBeVisible();
  expect(await screen.findByText('public.rows')).toBeVisible();
  expect(screen.getByText('insert · viewer')).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/policy'))).toHaveLength(1);
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save access policies' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit JSON / YAML' })).toBeNull();
  expect(screen.queryByLabelText('Dataset title')).toBeNull();
});

it('does not fetch private policy details for a dataset reader', async () => {
  open(answer('dataset', { catalog: catalog() }));
  fireEvent.click(screen.getByRole('tab', { name: 'Data actions' }));
  expect(screen.getByText('Data action rules are visible to dataset editors.')).toBeInTheDocument();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/policy'))).toBe(false);
  expect(screen.queryByRole('link', { name: 'Edit dataset' })).toBeNull();
});

it('keeps captures free of workspace navigation and mutation rules', () => {
  open(answer('dataset', {catalog: catalog(), captureKey: '123.abc'}, 'owner'));
  expect(screen.queryByRole('navigation', {name: 'Workspace'})).toBeNull();
  expect(screen.queryByRole('tablist', {name: 'Dataset workspace'})).toBeNull();
  expect(screen.getByLabelText('Dataset catalog')).toBeInTheDocument();
});

it.each([
  [undefined, 'No additional table restrictions. Granted actions apply to all tables.'],
  [[], 'No table writes are allowed.'],
] as const)('explains v2 grants and table restrictions without editing them (%s)', async (tables, message) => {
  policy = {version: 2, allow: [{actions: ['insert', 'update'], from: {artifactOwner: '$owner'}}], ...(tables ? {tables: [...tables]} : {})};
  open(answer('dataset', {catalog: catalog()}, 'owner'));
  fireEvent.click(screen.getByRole('tab', {name: 'Data actions'}));
  expect(await screen.findByText(message)).toBeVisible();
  expect(screen.getByText('insert, update')).toBeVisible();
  expect(screen.getByText('Apps owned by the dataset owner')).toBeVisible();
  expect(within(screen.getByLabelText('Read-only data actions')).queryByRole('button')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/policy')).every(([, options]) => !options?.method || options.method === 'GET')).toBe(true);
});

it('does not offer head policy inspection on an archived dataset', () => {
  open({...answer('dataset', {catalog: catalog()}, 'owner'), archived: {version: 1, head: 2}});
  fireEvent.click(screen.getByRole('tab', {name: 'Data actions'}));
  expect(screen.getByText('Data action rules are visible to dataset editors.')).toBeVisible();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/policy'))).toBe(false);
  expect(screen.queryByRole('link', {name: 'Edit dataset'})).toBeNull();
});

it.each(['owner', 'editor'] as const)('lets a dataset %s manage sharing directly from view mode', async role => {
  open(answer('dataset', {catalog: catalog()}, role));
  fireEvent.click(screen.getByRole('tab', {name: 'Sharing'}));
  expect(await screen.findByLabelText('Make private')).toBeVisible();
  expect(screen.getByLabelText('Invite email')).toBeVisible();
  expect(screen.queryByRole('dialog', {name: 'Sharing'})).toBeNull();
  fireEvent.click(screen.getByRole('link', {name: 'Manage access policies'}));
  expect(screen.getByRole('tab', {name: 'Data actions'})).toHaveAttribute('aria-selected', 'true');
  expect(await screen.findByLabelText('Read-only data actions')).toBeVisible();
});

it('gives a dataset reader link sharing without fetching or editing private sharing settings', () => {
  open(answer('dataset', {catalog: catalog()}));
  fireEvent.click(screen.getByRole('tab', {name: 'Sharing'}));
  expect(screen.getByRole('button', {name: 'Copy link'})).toBeVisible();
  expect(screen.queryByLabelText('Make private')).toBeNull();
  expect(screen.queryByLabelText('Invite email')).toBeNull();
  expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith('/sharing'))).toBe(false);
});

it.each(['image', 'pdf', 'file', 'viz', 'dataset'])('keeps workspace navigation on %s asset pages', format => {
  open(answer(format));
  const workspace = screen.getByRole('navigation', {name: 'Workspace'});
  expect(within(workspace).getByRole('link', {name: 'Assets'})).toHaveAttribute('href', '/assets');
  expect(screen.getAllByRole('main')).toHaveLength(1);
  if (format !== 'dataset') {
    const tabs = within(screen.getByRole('tablist', {name: 'Asset workspace'}));
    expect(tabs.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Asset', 'Sharing']);
    expect(tabs.getByRole('tab', {name: 'Asset'})).toHaveAttribute('aria-selected', 'true');
  }
});

it.each(['image', 'pdf', 'file', 'viz', 'dataset'])('leaves workspace navigation out of %s captures', format => {
  open(answer(format, {captureKey: '123.abc'}));
  expect(screen.queryByRole('navigation', {name: 'Workspace'})).toBeNull();
  expect(screen.getAllByRole('main')).toHaveLength(1);
  expect(streams).toHaveLength(0);
});

it.each(['image', 'pdf', 'file', 'viz'])('embeds sharing for a %s owner and returns to the asset', async format => {
  open(answer(format, {}, 'owner'));
  fireEvent.click(screen.getByRole('tab', {name: 'Sharing'}));
  expect(await screen.findByLabelText('Make private')).toBeVisible();
  expect(screen.getByRole('region', {name: 'Sharing'})).toBeVisible();
  expect(screen.queryByRole('dialog', {name: 'Sharing'})).toBeNull();
  fireEvent.click(screen.getByRole('tab', {name: 'Asset'}));
  expect(screen.queryByRole('region', {name: 'Sharing'})).toBeNull();
});
