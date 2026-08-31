/**
 * The browser tab follows the document.
 *
 * `<title>` is server-rendered once, from the row as it stood when the page was
 * requested. A reader who opens an agent's still-empty document therefore gets
 * "Untitled" in the tab, and it stays "Untitled" for the whole session no
 * matter what the agent writes — the live stream repaints the document and the
 * in-page name, but nothing ever touched document.title. The tab is the name
 * the reader sees in their window list, so it has to follow too.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import ArtifactSurface from '@/components/ArtifactSurface';

vi.mock('@/lib/story/use-live-artifact', () => ({ useLiveArtifact: () => null }));

const base = {
  id: 'art_1', editId: 'e1', format: 'markup' as const, source: '', content: '',
  columns: [], compiledCss: null, theme: null, colorMode: null,
  template: null, refs: [], version: 1,
};

describe('the tab title follows the document', () => {
  beforeEach(() => { document.title = 'stale'; });

  it('derives the tab title from the heading when nothing is named', () => {
    render(<ArtifactSurface {...base} title={null} source={'<div><h1>Healthy Eating</h1></div>'} />);
    expect(document.title).toBe('Healthy Eating');
  });

  it('follows a heading the agent rewrites under an open page', () => {
    const { rerender } = render(
      <ArtifactSurface {...base} title={null} source={'<div><p>working…</p></div>'} />,
    );
    expect(document.title).toBe('Untitled');
    rerender(<ArtifactSurface {...base} title={null} source={'<div><h1>Healthy Eating</h1></div>'} />);
    expect(document.title).toBe('Healthy Eating');
  });

  it('an explicit name still wins over the heading', () => {
    render(<ArtifactSurface {...base} title="Named by a human" source={'<div><h1>Healthy Eating</h1></div>'} />);
    expect(document.title).toBe('Named by a human');
  });
});
