/**
 * A FOLDER IS A DOCUMENT IN THE SHELL TOO.
 *
 * Serving already treats it as one (server/app `servesDocumentDirectly` admits
 * `format: 'folder'` beside `markup`), and the folder's own scaffold IS the
 * document — so the owner, who is the one person the shell is for, must see the
 * FRAME. It did not: the surface's document branch was `format === 'markup'`,
 * and a folder fell through to the data-tier view, which draws a table for a
 * dataset, a picture for an image and NOTHING for a folder. An owner opening
 * their own folder got a page of chrome around an empty column.
 *
 * The one thing the shell adds that a document does not have is the way to make
 * ANOTHER folder inside this one: `New folder`, in the same bar as every other
 * capability, through the session twin of create with this folder as the
 * parent. The new row arrives by the existing live ping — a folder's source
 * names its own id as a table, so it is a data dependency of itself
 * (lib/folders notifyParent) — which is why nothing here reloads.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('@/components/AnnotationLayer', () => ({ default: () => null }));
vi.mock('@/components/ArtifactEditor', () => ({
  default: () => (<header aria-label="Editor toolbar"><input aria-label="Title" /></header>),
}));

import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';

class FakeEventSource {
  addEventListener() {}
  removeEventListener() {}
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  close() {}
}

const posts: Array<{ url: string; body: Record<string, unknown> }> = [];

beforeEach(() => {
  window.location.hash = '';
  posts.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push({ url: String(url), body });
      return new Response(JSON.stringify({ id: 'new001', ...body }), { status: 201 });
    }
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.location.hash = ''; });

const folderProps = (over: Partial<ArtifactSurfaceProps> = {}): ArtifactSurfaceProps => ({
  id: 'fld001',
  editId: 'edit_1',
  format: 'folder',
  title: 'Reports',
  source: '<Files data="$children" variant="icons" />',
  template: null,
  refs: [],
  version: 1,
  content: '',
  columns: [],
  compiledCss: null,
  theme: null,
  colorMode: null,
  ...over,
});

const openDocumentControls = () => fireEvent.click(screen.getByLabelText('Open artifact controls'));

describe('a folder in the shell', () => {
  it('is served in the document frame, like the document it is', () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...folderProps()} /></ArtifactShell>);
    expect(screen.getByLabelText('Artifact viewport')).toBeInTheDocument();
  });

  it('offers New folder to whoever may edit it, and to nobody else', () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...folderProps()} /></ArtifactShell>);
    openDocumentControls();
    expect(screen.getByLabelText('New folder')).toBeInTheDocument();
    // Renaming is the title field the editor already has — no second door.
    expect(screen.getByLabelText('Edit artifact')).toBeInTheDocument();
    cleanup();

    render(<ArtifactShell role="commenter"><ArtifactSurface {...folderProps()} /></ArtifactShell>);
    openDocumentControls();
    expect(screen.queryByLabelText('New folder')).not.toBeInTheDocument();
    cleanup();

    // A plain reader of a document gets no New folder anywhere near it.
    render(<ArtifactShell role="owner"><ArtifactSurface {...folderProps({ format: 'markup' })} /></ArtifactShell>);
    openDocumentControls();
    expect(screen.queryByLabelText('New folder')).not.toBeInTheDocument();
  });

  it('creates the new folder UNDER this one, inline, with no navigation', async () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...folderProps()} /></ArtifactShell>);
    openDocumentControls();
    fireEvent.click(screen.getByLabelText('New folder'));
    const field = screen.getByLabelText('Folder name');
    fireEvent.change(field, { target: { value: '2026' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe('/api/my/artifacts');
    expect(posts[0].body).toMatchObject({ format: 'folder', title: '2026', parent_id: 'fld001' });
    // The listing follows the live ping the write already sends; the field
    // simply closes.
    await waitFor(() => expect(screen.queryByLabelText('Folder name')).not.toBeInTheDocument());
  });

  it('Escape discards the name without writing anything', () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...folderProps()} /></ArtifactShell>);
    openDocumentControls();
    fireEvent.click(screen.getByLabelText('New folder'));
    fireEvent.keyDown(screen.getByLabelText('Folder name'), { key: 'Escape' });
    expect(screen.queryByLabelText('Folder name')).not.toBeInTheDocument();
    expect(posts).toHaveLength(0);
  });

  it('?intent=new-folder opens the field once, and an unknown intent does nothing', () => {
    render(<ArtifactShell role="owner"><ArtifactSurface {...folderProps({ search: '?intent=new-folder' })} /></ArtifactShell>);
    expect(screen.getByLabelText('Folder name')).toBeInTheDocument();
    cleanup();
    render(<ArtifactShell role="owner"><ArtifactSurface {...folderProps({ search: '?intent=nonsense' })} /></ArtifactShell>);
    expect(screen.queryByLabelText('Folder name')).not.toBeInTheDocument();
  });
});
