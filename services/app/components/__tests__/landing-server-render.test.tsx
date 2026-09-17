import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import Landing from '../Landing';

describe('shared landing server-render compatibility', () => {
  it('renders the actual landing and topbar without browser globals', () => {
    expect(typeof window).toBe('undefined');
    const html = renderToStaticMarkup(<StaticRouter location="/"><Landing /></StaticRouter>);
    expect(html).toContain('aria-label="About Artifactbin"');
    expect(html).toContain('Create, edit and share');
    expect(html).toContain('href="/login"');
    expect(html).not.toContain('/landing/');
    expect(html).not.toContain('<canvas');
    expect(html).toContain('aria-label="Main navigation"');
    expect(html).not.toContain('undefined/api');
  });
});
