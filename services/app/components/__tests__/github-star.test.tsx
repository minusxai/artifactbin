import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GitHubStar from '../GitHubStar';

describe('GitHub repository star button', () => {
  it('renders the vendor iframe with a permanent direct-link fallback', () => {
    const html = renderToStaticMarkup(<GitHubStar placement="desktop-bar" />);
    expect(html).toContain('https://buttons.github.io/buttons.html?theme=light#');
    expect(html).toContain('Open artifactbin on GitHub (fallback link)');
  });
  it('has an in-flow desktop topbar placement, not a floating corner', () => {
    const html = renderToStaticMarkup(<GitHubStar placement={'desktop-bar' as never} />);
    expect(html).toContain('https://github.com/minusxai/artifactbin');
    expect(html).not.toContain('fixed');
    expect(html).not.toContain('sm:bottom-');
  });
});
