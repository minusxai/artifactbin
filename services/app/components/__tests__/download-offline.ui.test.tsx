/**
 * THE OFFLINE FILE'S DOOR ON THE PAGE. `/a/<id>/download` answers one
 * self-contained `.html` to anyone who may read the document; the page offers
 * it from its controls to exactly those people, for the version it is showing.
 *
 * The link is real (href + download), so it reads as what it is; the click
 * fetches first, because a document too large for one file is refused with a
 * reason (413) and a bare download link would save that refusal as the file.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { render } from '@/test/helpers/surface-ui';
import { setupSurface, surfaceProps } from '@/test/helpers/inline-surface';
import ArtifactSurface from '../ArtifactSurface';
import ArtifactShell from '../ArtifactShell';
import type { ArtifactRole } from '@/lib/share-roles';

afterEach(() => vi.unstubAllGlobals());

const page = (role: ArtifactRole, props: Parameters<typeof ArtifactSurface>[0]) => (
  <ArtifactShell role={role}><ArtifactSurface {...props} /></ArtifactShell>
);

const openControls = () => {
  const button = screen.queryByLabelText('Open artifact controls');
  if (button) { fireEvent.click(button); return; }
  const trigger = document.querySelector<HTMLElement>('[data-mx-reader-trigger="controls"]');
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger!);
};

describe('Download for offline', () => {
  beforeEach(setupSurface);

  it('is a download link to the head\'s offline file for a reader who can only view', async () => {
    render(page('none', surfaceProps({ source: '<p>Read only</p>' })));
    openControls();
    const link = await screen.findByRole('link', { name: 'Download for offline' });
    expect(link).toHaveAttribute('href', '/a/story1/download');
    expect(link).toHaveAttribute('download');
    expect(link).not.toHaveAttribute('title');
  });

  it('describes itself in the app tooltip', async () => {
    render(page('viewer', surfaceProps({})));
    openControls();
    const link = await screen.findByRole('link', { name: 'Download for offline' });
    fireEvent.focus(link);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('One HTML file you can open, edit and comment on without a connection.');
  });

  it('names the archived version the page is showing', async () => {
    render(page('owner', surfaceProps({ archived: { version: 2, head: 7 }, source: '<p>Version two</p>' })));
    openControls();
    const link = await screen.findByRole('link', { name: 'Download for offline' });
    expect(link).toHaveAttribute('href', '/a/story1/download?version=2');
  });

  it('is not offered on a dataset', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ visibility: 'private', linkRole: 'viewer', shares: [], access: 'readwrite' }))));
    render(page('owner', surfaceProps({ format: 'dataset', dataPreview: '[]', columns: [] })));
    openControls();
    await screen.findByLabelText('Owner actions');
    expect(screen.queryByRole('link', { name: 'Download for offline' })).toBeNull();
  });

  it('saves the fetched file under the name the route gives it', async () => {
    const fetchMock = vi.fn(async () => new Response('<!doctype html><script id="afbin-file"></script>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': 'attachment; filename="Q3 report.html"; filename*=UTF-8\'\'Q3%20report%20%E2%80%94%20final.html' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    // jsdom has no object URLs; the page's use of them is the contract here.
    const createObjectURL = vi.fn((_blob: Blob) => 'blob:offline-file');
    const revokeObjectURL = vi.fn();
    const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const saved: Array<{ href: string; download: string }> = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    try {
      render(page('viewer', surfaceProps({})));
      openControls();
      fireEvent.click(await screen.findByRole('link', { name: 'Download for offline' }));
      await waitFor(() => expect(saved).toEqual([{ href: 'blob:offline-file', download: 'Q3 report — final.html' }]));
      expect(fetchMock).toHaveBeenCalledWith('/a/story1/download', expect.anything());
      // The saved bytes are the route's file (a Blob from fetch's own realm, so read, not instanceof).
      expect(await createObjectURL.mock.calls[0]![0].text()).toContain('id="afbin-file"');
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:offline-file'));
      expect(screen.queryByRole('alert')).toBeNull();
    } finally { click.mockRestore(); Object.assign(URL, objectUrls); }
  });

  it('shows the route\'s reason when the document is too large for one file', async () => {
    const message = 'This document is too large for one offline file (40 MB of its 25 MB limit).';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'too_large', message }, { status: 413 })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
    try {
      render(page('viewer', surfaceProps({})));
      openControls();
      fireEvent.click(await screen.findByRole('link', { name: 'Download for offline' }));
      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(message);
      // The controls stay open, so the reason is read where the link was pressed.
      expect(screen.getByRole('link', { name: 'Download for offline' })).toBeInTheDocument();
      expect(click).not.toHaveBeenCalled();
    } finally { click.mockRestore(); }
  });

  it('says the file could not be made when a refusal carries no reason', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'not_found' }, { status: 404 })));
    render(page('viewer', surfaceProps({})));
    openControls();
    fireEvent.click(await screen.findByRole('link', { name: 'Download for offline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The offline file could not be made (HTTP 404).');
  });
});
