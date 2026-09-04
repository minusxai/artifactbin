/**
 * The frame gets the whole artifact viewport, and the PARENT page carries no
 * credit bar of its own. It never should have: the reader's attribution lives
 * inside the served document (lib/story/reader-chrome), where the author's
 * handle is the byline — and the strip this test was written for is retired.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';


import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';

class FakeEventSource {
  /** The named `data` channel (a dataset under the document changed). */
  listeners: Record<string, Array<(e: MessageEvent) => void>> = {};
  addEventListener(type: string, fn: (e: MessageEvent) => void) { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: (e: MessageEvent) => void) { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  emitData(payload: unknown) { for (const fn of this.listeners.data ?? []) fn({ data: JSON.stringify(payload) } as MessageEvent); }
  onmessage: ((e: MessageEvent) => void) | null = null;
  close() {}
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

const surfaceProps: ArtifactSurfaceProps = {
  id: 'story1', editId: 'edit_1', format: 'dataset', title: 'doc',
  source: null, template: null, refs: [], version: 1,
  content: '<p>hi</p>', columns: [], compiledCss: null, theme: null, colorMode: null,
};

describe('the artifact viewport boundary', () => {
  it('gives the full artifact viewport to /raw, with no parent-page footer', () => {
    render(<ArtifactSurface {...surfaceProps} format="markup" source="<p>doc</p>" />);

    expect(screen.getByLabelText('Artifact viewport')).toHaveClass('fixed', 'overflow-hidden');
    expect(screen.getByTitle('artifact')).toHaveAttribute('src', '/a/story1/raw');
    expect(screen.queryByLabelText('Artifact credits')).not.toBeInTheDocument();
  });

  it('does not add the fixed artifact viewport to data-tier pages', () => {
    render(<ArtifactSurface {...surfaceProps} />);
    expect(screen.queryByLabelText('Artifact viewport')).not.toBeInTheDocument();
  });
});
