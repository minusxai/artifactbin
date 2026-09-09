import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GitHubStar from '../GitHubStar';

describe('GitHub repository star button', () => {
  it('renders the current official Invertocat geometry from GitHub’s brand toolkit', () => {
    const html = renderToStaticMarkup(<GitHubStar placement="desktop-bar" />);
    expect(html).toContain('viewBox="0 0 98 96"');
    expect(html).toContain('M41.4395 69.3848C28.8066 67.8535');
  });
  it('has an in-flow desktop topbar placement, not a floating corner', () => {
    const html = renderToStaticMarkup(<GitHubStar placement={'desktop-bar' as never} />);
    expect(html).toContain('https://github.com/minusxai/artifactbin');
    expect(html).not.toContain('fixed');
    expect(html).not.toContain('sm:bottom-');
  });
});
