import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import Landing from '../Landing';
import { AppBar } from '../PageChrome';

describe('shared landing server-render compatibility', () => {
  it('renders the actual landing and topbar without browser globals', () => {
    expect(typeof window).toBe('undefined');
    const html = renderToStaticMarkup(<StaticRouter location="/"><AppBar /><Landing /></StaticRouter>);
    expect(html).toContain('Your agents');
    expect(html).toContain('interactive HTML documents');
    expect(html).toContain('aria-label="Home"');
    expect(html).not.toContain('undefined/api');
  });
});
