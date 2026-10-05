/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { STORY_TEMPLATE_NAMES } from '@/lib/validation/atlas-schemas';
import { STORY_SYSTEMS } from '@/lib/data/story/story-systems';
import GetStarted from '@/solid/components/GetStarted';
import { afbinInstallCommand, afbinWindowsInstallCommand } from '@/lib/serving/agent-discovery-tags';
import { App } from '@/solid/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('serves the human tour with current templates, live design systems, install command and working contents links', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/page/session' ? Response.json({ user: null, kind: 'none', onboarded: true }) : Response.json({})));
  window.history.replaceState(null, '', '/docs-human');
  render(() => <App />);
  const main = await screen.findByRole('main');
  for (const system of STORY_SYSTEMS) {
    expect(main).toHaveTextContent(system.label);
    expect(main.querySelector(`[data-design-specimen="${system.name}"] svg`)).not.toBeNull();
  }
  expect(main.querySelector('img[src^="/story-themes/"]')).toBeNull();
  for (const template of STORY_TEMPLATE_NAMES) expect(main).toHaveTextContent(template);
  for (const field of ['markup', 'dataset', 'viz', 'image']) expect(main).toHaveTextContent(field);
  expect(main.textContent).not.toContain('/plugin');
  expect(main.textContent).not.toContain('—');
  expect(screen.getByRole('button', { name: 'Copy the CLI install command' })).toBeInTheDocument();
  const contents = screen.getByRole('navigation', { name: 'Contents' });
  for (const link of within(contents).getAllByRole('link')) expect(document.getElementById(link.getAttribute('href')!.slice(1))).toBeInTheDocument();
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
