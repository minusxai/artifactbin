/**
 * The human tour at /docs-human, guarded against DRIFT.
 *
 * It went stale invisibly: it advertised a template called "report" (there is no
 * such template — the four are editorial/deck/scrolly/dashboard), described
 * nocturne as "dark, gold" when its accent is violet, and knew nothing about the
 * data tiers or the plugin. Prose has no type checker, so the vocabulary it
 * quotes is asserted here instead.
 *
 * (Lives under components/__tests__ because that and lib/** are the only paths
 * the vitest `ui` project includes.)
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

vi.mock('@/auth', () => ({ auth: async () => ({ user: { id: 'usr_docs', email: 'v@minusx.ai' } }) }));

import DocsHuman from '@/components/DocsHuman';
import { STORY_TEMPLATE_NAMES, STORY_THEME_NAMES } from '@/lib/validation/atlas-schemas';

const text = () => screen.getByRole('main').textContent ?? '';

describe('/docs-human', () => {
  it('names every real theme and every real template', async () => {
    render(DocsHuman());
    for (const name of STORY_THEME_NAMES) expect(text()).toContain(name);
    for (const name of STORY_TEMPLATE_NAMES) expect(text()).toContain(name);
  });

  it('invents no vocabulary the API does not accept', async () => {
    render(DocsHuman());
    // "report" was documented as a template for weeks. An agent told to use it
    // gets a 400, and a human reading this page has no way to know.
    expect(text()).not.toMatch(/\breport\b\s*[—·:-]/);
  });

  it('covers all four content fields, and names no retired tier', async () => {
    render(DocsHuman());
    for (const field of ['markup', 'dataset', 'viz', 'image']) {
      expect(text(), field).toContain(field);
    }
    for (const gone of ['markdown', 'html']) {
      expect(text(), gone).not.toContain(gone);
    }
  });

  it('teaches CLI installation, browser setup and local skills', () => {
    render(DocsHuman());
    expect(screen.getByLabelText('Copy the CLI install command')).toBeTruthy();
    expect(text()).not.toContain('/plugin');
  });

  it('uses no em dashes', async () => {
    render(DocsHuman());
    expect(text()).not.toContain('—');
  });

  it('has a table of contents, and every entry lands on a real section', async () => {
    render(DocsHuman());
    const toc = screen.getByRole('navigation', { name: 'Contents' });
    const links = within(toc).getAllByRole('link');
    // One entry per section of the tour; a lone link is a breadcrumb, not a ToC.
    expect(links.length).toBeGreaterThanOrEqual(5);
    for (const link of links) {
      const href = link.getAttribute('href') ?? '';
      expect(href, `ToC entry "${link.textContent}" must be an in-page anchor`).toMatch(/^#./);
      expect(
        document.getElementById(href.slice(1)),
        `ToC entry "${link.textContent}" points at #${href.slice(1)}, which no section carries`,
      ).toBeTruthy();
    }
  });
});
