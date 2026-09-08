import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { TrustedUiHost } from '../TrustedUi';
import { AppNavigationBinding } from '@/web/AppNavigation';
import { afterEach, expect, it, vi } from 'vitest';
import ArtifactShell from '../ArtifactShell';
import ArtifactSurface, { type ArtifactSurfaceProps } from '../ArtifactSurface';
import { storyBodyFor } from '@/lib/story/body';
import type { ArtifactLiveEvent } from '@/lib/story/live';

const liveState = vi.hoisted(() => ({frame: null as ArtifactLiveEvent | null}));
vi.mock('@/lib/story/use-live-artifact', () => ({useLiveArtifact: () => liveState.frame}));
afterEach(() => { liveState.frame = null; });

afterEach(() => vi.unstubAllGlobals());
const props: ArtifactSurfaceProps = {
  id: 'story1', editId: 'edit_1', format: 'markup', title: 'Top-level fixture',
  source: '<p id="n1">Top-level author text</p>', content: '<p id="n1">Top-level author text</p>',
  template: null, refs: [], version: 1, columns: [], compiledCss: null, theme: null, colorMode: 'light', liveEnabled: false,
};

it('routes artifact Home and author links without a native document navigation', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const roots: ShadowRoot[] = [];
  const attach = Element.prototype.attachShadow;
  const spy = vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function(this: Element, init: ShadowRootInit) {
    const root = attach.call(this, init); roots.push(root); return root;
  });
  function Address() { return <p aria-label="Current route">{useLocation().pathname}</p>; }
  try {
    render(<MemoryRouter initialEntries={['/a/story1']}><AppNavigationBinding /><Address />
      <TrustedUiHost styles="" mode="light"><ArtifactSurface {...props} authorUsername="writer" /></TrustedUiHost>
    </MemoryRouter>);
    await waitFor(() => expect(roots[0]?.querySelector('[aria-label="Home"]')).not.toBeNull());
    fireEvent.click(roots[0].querySelector('[aria-label="Home"]')!);
    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent(/^\/$/));
    fireEvent.click(roots[0].querySelector('[aria-label="View @writer\'s profile"]')!);
    await waitFor(() => expect(screen.getByLabelText('Current route')).toHaveTextContent('/@writer'));
  } finally { spy.mockRestore(); }
});

it('renders managed prose in the parent document and disposes it on route unmount', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const view = render(<ArtifactShell role="viewer"><ArtifactSurface {...props} /></ArtifactShell>);
  await waitFor(() => expect(screen.getByText('Top-level author text')).toBeVisible());
  expect(view.container.querySelector('iframe[title="artifact"]')).toBeNull();
  expect(screen.getByText('Top-level author text').ownerDocument).toBe(document);
  expect(screen.getByLabelText('Artifact viewport')).toHaveStyle({paddingTop:'44px'});
  expect(view.container.querySelector('[data-mx-story-root]')).toBeTruthy();
  expect(view.container.querySelector('style[data-mx-presentation]')).toHaveTextContent('font-size:2.5rem');
  expect(view.container.querySelector('[data-artifact-story-host]')).toHaveStyle({'--mx-vh':'calc(100vh - 44px)'});
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

it('propagates prepared and live glyph replacements into the actual mounted story', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({})));
  const nodes = storyBodyFor('<Icon name="Heart" />')!.body;
  const glyphs = {Heart: {cls: 'lucide-heart', inner: '<path d="M1 2 L3 4" />'}};
  const prepared = {nodes, refData: {}, glyphs: {}, colorMode: 'light' as const, chrome: true};
  const page = (map: typeof prepared.glyphs) => <ArtifactShell role="viewer"><ArtifactSurface {...props} preparedStory={{...prepared, glyphs: map}} /></ArtifactShell>;
  const view = render(page({}));
  const host = view.container.querySelector('[data-artifact-story-host]')!;
  view.rerender(page(glyphs));
  await waitFor(() => expect(host.querySelector('svg.lucide-heart path')).toHaveAttribute('d','M1 2 L3 4'));
  liveState.frame = {editId:'edit_2',version:2,by:null,format:'markup',title:props.title,source:'<Icon name="Star" />',content:null,
    theme:null,colorMode:'light',template:null,nodes:storyBodyFor('<Icon name="Star" />')!.body,
    glyphs:{Star:{cls:'lucide-star',inner:'<path d="M5 6 L7 8" />'}}};
  view.rerender(page(glyphs));
  await waitFor(() => expect(host.querySelector('svg.lucide-star path')).toHaveAttribute('d','M5 6 L7 8'));
  expect(view.container.querySelector('[data-artifact-story-host]')).toBe(host);
});
