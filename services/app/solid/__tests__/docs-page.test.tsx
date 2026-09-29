/* @jsxImportSource solid-js */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@solidjs/testing-library';
import { afterEach, expect, it, vi } from 'vitest';
import { STORY_TEMPLATE_NAMES, STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';
import { App } from '@/solid/App';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });
it('serves the human tour with current templates, themes, install command and working contents links', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url === '/api/page/session' ? Response.json({ user: null, kind: 'none', onboarded: true }) : Response.json({})));
  window.history.replaceState(null, '', '/docs-human');
  render(() => <App />);
  const main = await screen.findByRole('main');
  for (const theme of STORY_THEME_NAMES) expect(main).toHaveTextContent(theme);
  for (const template of STORY_TEMPLATE_NAMES) expect(main).toHaveTextContent(template);
  for (const field of ['markup', 'dataset', 'viz', 'image']) expect(main).toHaveTextContent(field);
  expect(main.textContent).not.toContain('/plugin');
  expect(main.textContent).not.toContain('—');
  expect(screen.getByRole('button', { name: 'Copy the CLI install command' })).toBeInTheDocument();
  const contents = screen.getByRole('navigation', { name: 'Contents' });
  for (const link of within(contents).getAllByRole('link')) expect(document.getElementById(link.getAttribute('href')!.slice(1))).toBeInTheDocument();
});
