import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import GitHubStar from '../GitHubStar';

describe('GitHub repository star button', () => {
  it('renders the custom icon and direct link before hydration', () => {
    const html = renderToStaticMarkup(<GitHubStar placement="desktop-bar" />);
    expect(html).toContain('fill="light-dark(#eac54f, #e3b341)"');
    expect(html).toContain('Star artifactbin on GitHub');
    expect(html).not.toContain('<iframe');
  });
  it('has an in-flow desktop topbar placement, not a floating corner', () => {
    const html = renderToStaticMarkup(<GitHubStar placement={'desktop-bar' as never} />);
    expect(html).toContain('https://github.com/minusxai/artifactbin');
    expect(html).not.toContain('fixed');
    expect(html).not.toContain('sm:bottom-');
  });
});
