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
import { InboxProvider } from '@/solid/web/notifications';
import { ArtifactDataPage, type DataAnswer } from '@/solid/pages/ArtifactData';
import type { DatasetCatalog } from '@/lib/datasets/types';
import { datasetQuerySnippet } from '@/lib/story/dataset-usage';

const streams: Array<{ url: string; onmessage: ((event: { data: string }) => void) | null; closed: boolean }> = [];
class FakeEventSource {
  url: string; onmessage: ((event: { data: string }) => void) | null = null; closed = false;
  constructor(url: string) { this.url = url; streams.push(this); }
  addEventListener() {} removeEventListener() {} close() { this.closed = true; }
}
const catalog = (name = 'rows'): DatasetCatalog => ({ kind: 'stored', defaultSchema: 'public', refreshSeconds: 0, tables: [{ schema: 'public', name, columns: [{ name: 'region', type: 'string' }] }] } as unknown as DatasetCatalog);
let pageAnswers: unknown[] = [];
beforeEach(() => {
  streams.length = 0; pageAnswers = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/tables')) return Response.json({ rows: [{ region: 'North' }], columns: [{ name: 'region', type: 'string' }], refreshedAt: '2026-09-30T00:00:00.000Z' });
    if (url.endsWith('/events/frame')) return Response.json({ editId: 'e2', version: 2, by: null, format: 'dataset', title: 'Regional sales', source: null, dataPreview: null });
    if (url.startsWith('/api/page/artifact/')) return Response.json(pageAnswers.shift() ?? {});
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
  expect(within(panel.getByLabelText('Owner actions')).getByRole('button', { name: 'Share' })).toBeInTheDocument();
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
  expect(panel.getByRole('button', { name: 'Share' })).toBeInTheDocument();
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

it('photographs a capture without opening a live stream', () => {
  open(answer('image', { captureKey: 'k' }));
  expect(screen.getByRole('main')).toContainElement(screen.getByRole('img', { name: 'Regional sales' }));
  expect(streams).toHaveLength(0);
});
