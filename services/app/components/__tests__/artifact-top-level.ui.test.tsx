import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';

afterEach(() => vi.unstubAllGlobals());
const props: ArtifactSurfaceProps = {
  id: 'story1', editId: 'edit_1', format: 'markup', title: 'Top-level fixture',
  source: '<p id="n1">Top-level author text</p>', content: '<p id="n1">Top-level author text</p>',
  template: null, refs: [], version: 1, columns: [], compiledCss: null, theme: null, colorMode: 'light', liveEnabled: false,
};

it('renders managed prose in the parent document and disposes it on route unmount', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const view = render(<ArtifactShell role="viewer"><ArtifactSurface {...props} /></ArtifactShell>);
  await waitFor(() => expect(screen.getByText('Top-level author text')).toBeVisible());
  expect(view.container.querySelector('iframe[title="artifact"]')).toBeNull();
  expect(screen.getByText('Top-level author text').ownerDocument).toBe(document);
  view.unmount();
  expect(screen.queryByText('Top-level author text')).toBeNull();
});

it('does not let deferred disposal undo a replacement mount under StrictMode', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const view = render(<StrictMode><ArtifactShell role="viewer"><ArtifactSurface key="story1" {...props} compiledCss=".first{}" theme="modernist" /></ArtifactShell></StrictMode>);
  view.rerender(<StrictMode><ArtifactShell role="viewer"><ArtifactSurface key="story2" {...props} id="story2" source='<p id="n2">Replacement</p>' compiledCss=".second{}" theme="organic" colorMode="dark" /></ArtifactShell></StrictMode>);
  await waitFor(() => expect(screen.getByText('Replacement')).toBeVisible());
  await Promise.resolve();
  expect(document.documentElement).toHaveAttribute('data-theme', 'organic');
  expect(document.documentElement).toHaveClass('dark');
  expect(document.head.querySelector('style[data-mx-tw]')).toHaveTextContent('.second{}');
  view.unmount();
});
