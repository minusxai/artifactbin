/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import { STORY_SYSTEMS } from '@/lib/data/story/story-systems';
import GetStarted from '@/solid/components/GetStarted';
import { App } from '@/solid/App';
import { afbinInstallCommand, afbinWindowsInstallCommand, gettingStarted, gettingStartedMarkdown } from '@/lib/serving/getting-started';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('serves the human tour with current templates, live design systems and a link to Getting started', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/page/session' ? Response.json({ user: null, kind: 'none', onboarded: true }) : Response.json({})));
  window.history.replaceState(null, '', '/docs-human');
  render(() => <App />);
  await vi.dynamicImportSettled();
  const main = await screen.findByRole('main');
  expect(within(screen.getByRole('navigation', { name: 'Workspace' })).getByRole('link', { name: 'Human docs' })).toHaveAttribute('aria-current', 'page');
  for (const system of STORY_SYSTEMS) {
    expect(main).toHaveTextContent(system.label);
    expect(main.querySelector(`[data-design-specimen="${system.name}"] img`)).toHaveAttribute('src', `/design-systems/${system.name}${system.defaultMode === 'dark' ? '-dark' : ''}.webp`);
  }
  expect(main.querySelector('img[src^="/story-themes/"]')).toBeNull();
  expect(main.querySelector('link[href*="design-system"]')).toBeNull();
  for (const template of STORY_TEMPLATE_NAMES) expect(main).toHaveTextContent(template);
  for (const field of ['markup', 'dataset', 'viz', 'image']) expect(main).toHaveTextContent(field);
  expect(main.textContent).not.toContain('/plugin');
  expect(main.textContent).not.toContain('—');
  expect(screen.getByRole('link', { name: 'Getting started guide' })).toHaveAttribute('href', '/getting-started');
  const contents = screen.getByRole('navigation', { name: 'Contents' });
  for (const link of within(contents).getAllByRole('link')) expect(document.getElementById(link.getAttribute('href')!.slice(1))).toBeInTheDocument();
});

it('renders the same Getting started instructions as Markdown, with sidebar and copyable commands', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/page/session' ? Response.json({ user: null, kind: 'none', onboarded: true }) : Response.json({})));
  window.history.replaceState(null, '', '/getting-started');
  render(() => <App />);
  const main = await screen.findByRole('main');
  expect(within(main).getByRole('heading', { level: 1, name: 'Getting started' })).toBeInTheDocument();
  expect(screen.getByRole('navigation', { name: 'Workspace' })).toBeInTheDocument();
  expect(within(main).getByRole('link', { name: 'Markdown for agents ↗' })).toHaveAttribute('href', '/getting-started.md');
  const guide = gettingStarted(window.location.origin);
  const markdown = gettingStartedMarkdown(window.location.origin);
  for (const section of guide.sections) {
    expect(document.getElementById(section.id)).toBeInTheDocument();
    for (const block of section.blocks) {
      expect(markdown).toContain(block.text);
      expect(within(main).getByText(block.text, { normalizer: text => text })).toBeInTheDocument();
      if (block.kind === 'command') expect(within(main).getByRole('button', { name: `Copy ${block.label.toLowerCase()} command` })).toBeInTheDocument();
    }
  }
});

it.each(['Win32','MacIntel'])('shows executable Node preparation and npm instructions on %s', (platform) => {
  const prior=Object.getOwnPropertyDescriptor(window.navigator,'platform');
  Object.defineProperty(window.navigator,'platform',{configurable:true,value:platform});
  try {
    render(()=><GetStarted />);
    const command=platform==='Win32'?afbinWindowsInstallCommand(window.location.origin):afbinInstallCommand(window.location.origin);
    expect(screen.getByText(command,{normalizer:text=>text})).toBeInTheDocument();
    expect(screen.getByText(/reuses supported Node\/npm/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('ExecutionPolicy Bypass');
  } finally { if(prior)Object.defineProperty(window.navigator,'platform',prior);else Reflect.deleteProperty(window.navigator,'platform'); }
});
