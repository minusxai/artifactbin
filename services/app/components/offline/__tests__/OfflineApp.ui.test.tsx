/**
 * The offline file's page over the checked-in gate fixture
 * (scripts/fixtures/offline-file): the same ArtifactFile the three-browser
 * gate opens from file://, here in jsdom for the behaviour that does not need
 * a real browser.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsxNode } from '@/lib/jsx';
import { splitHelmet } from '@/lib/story/helmet';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { ACCESS_PENDING } from '@/lib/story-runtime/store';
import { OFFLINE_FILTER_REASON, OFFLINE_MUTATION_REASON, parseArtifactFile, type ArtifactFile } from '@/lib/offline/file-format';
import { renderArtifactFileHtml } from '@/lib/offline/file-html';
import { mountOfflineFile } from '@/lib/offline/mount';
import { NEEDS_CONNECTION, OfflineApp } from '../OfflineApp';

afterEach(cleanup);

const FIXTURE = path.resolve(process.cwd(), '../../scripts/fixtures/offline-file/artifact-file.json');
const fixture = (): ArtifactFile => parseArtifactFile(JSON.parse(readFileSync(FIXTURE, 'utf8')));
const rowTexts = () => screen.getAllByRole('row').slice(1).map((row) => row.textContent);

describe('OfflineApp', () => {
  it('says what it is in a top bar landmark: an offline copy, the data time, and the live link', () => {
    const file = fixture();
    const view = render(<OfflineApp file={file} />);
    const shadow = view.container.querySelector('[data-trusted-ui]')!.shadowRoot!;
    const bar = within(shadow as unknown as HTMLElement).getByRole('banner', { name: 'Offline copy' });
    expect(bar).toHaveTextContent(`Offline copy of ${file.metadata.title}`);
    expect(bar).toHaveTextContent('data as of');
    expect(bar.querySelector('time')).toHaveAttribute('datetime', file.snapshot.at);
    const live = within(bar).getByRole('link', { name: 'Open live version' });
    expect(live).toHaveAttribute('href', file.liveUrl);
    expect(live).toHaveAttribute('rel', 'noreferrer');
  });

  it('renders the snapshot rows and swaps to a precomputed variant when the filter changes', async () => {
    render(<OfflineApp file={fixture()} />);
    expect(await screen.findByRole('heading', { name: 'Regional sales' })).toBeInTheDocument();
    await waitFor(() => expect(rowTexts()).toHaveLength(6));
    fireEvent.click(screen.getByRole('button', { name: 'Region' }));
    fireEvent.click(await screen.findByRole('option', { name: 'west' }));
    await waitFor(() => expect(rowTexts()).toHaveLength(2));
    expect(rowTexts().every((text) => text?.includes('west'))).toBe(true);
  });

  it('disables a frozen Value’s control with the offline reason', async () => {
    render(<OfflineApp file={fixture()} />);
    const field = await screen.findByRole('textbox', { name: 'Region pattern' });
    expect(field).toBeDisabled();
    expect(field).toHaveAttribute('aria-description', OFFLINE_FILTER_REASON);
    expect(screen.getByRole('button', { name: 'Region' })).toBeEnabled();
  });

  it('refuses the write by name and never waits on an access check', async () => {
    render(<OfflineApp file={fixture()} />);
    const button = await screen.findByRole('button', { name: 'Add a row' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-description', OFFLINE_MUTATION_REASON);
    expect(screen.getByText(OFFLINE_MUTATION_REASON)).toBeInTheDocument();
    // one debounce later, still the offline reason, never the pending check
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(screen.queryByText(ACCESS_PENDING)).toBeNull();
  });

  it('holds a map’s and a managed frame’s space with a same-size "needs a connection" stand-in', async () => {
    const base = fixture();
    const { body } = splitHelmet(parseJsxOrThrow('<div><DeckGL title="Stores" height={280} layers={[]} /><Iframe title="Widget" height={200}>{`<p>x</p>`}</Iframe></div>').nodes as JsxNode[]);
    render(<OfflineApp file={{ ...base, island: { ...base.island, nodes: body, dataflow: undefined } }} />);
    const map = await screen.findByRole('figure', { name: `Stores: ${NEEDS_CONNECTION.toLowerCase()}` });
    expect(map.style.height).toBe('280px');
    expect(within(map).getByRole('link', { name: 'Open live version' })).toHaveAttribute('href', base.liveUrl);
    const frame = screen.getByRole('figure', { name: `Widget: ${NEEDS_CONNECTION.toLowerCase()}` });
    expect(frame.style.height).toBe('200px');
  });
});

describe('mountOfflineFile', () => {
  const shell = (html: string) => {
    const doc = document.implementation.createHTMLDocument('file');
    doc.documentElement.innerHTML = new DOMParser().parseFromString(html, 'text/html').documentElement.innerHTML;
    return doc;
  };

  it('replaces the opening placeholder with the document', async () => {
    const doc = shell(renderArtifactFileHtml({ file: fixture(), code: 'AAAA' }));
    document.body.replaceChildren(...doc.body.childNodes);
    const root = mountOfflineFile(document);
    expect(await screen.findByRole('heading', { name: 'Regional sales' })).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    act(() => root?.unmount());
  });

  it('shows the reader-facing reason for a damaged file instead of the document', async () => {
    const html = renderArtifactFileHtml({ file: fixture(), code: 'AAAA' }).replace(/("format":)1/, '$1"x"');
    const doc = shell(html);
    document.body.replaceChildren(...doc.body.childNodes);
    const root = mountOfflineFile(document);
    expect(await screen.findByRole('alert')).toHaveTextContent(/damaged/i);
    act(() => root?.unmount());
  });
});
