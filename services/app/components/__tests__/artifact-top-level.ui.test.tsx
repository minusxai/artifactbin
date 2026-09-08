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
