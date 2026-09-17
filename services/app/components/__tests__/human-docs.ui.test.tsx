/**
 * The human tour at /docs-human, guarded against DRIFT.
 *
 * Prose has no type checker and goes stale invisibly, so what the tour says is
 * asserted here: theme and template names against the schemas the API accepts,
 * the content tiers against the four it has, the CLI as the only client, the
 * house voice (no em dashes), and a table of contents whose entries all land.
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
    // "report" is not a template. An agent told to use it gets a 400, and a
    // human reading this page has no way to know.
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

  it('teaches CLI installation, and names no plugin address', () => {
    render(DocsHuman());
    expect(screen.getByLabelText('Copy the CLI install command')).toBeTruthy();
    // The CLI is the only client. There is no plugin surface to send anyone to.
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
