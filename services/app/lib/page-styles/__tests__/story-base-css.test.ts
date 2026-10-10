import { expect, it } from 'vitest';
import { storyBaseCss } from '../story-base-css';

it('gives every document its own text and ground colors, including when no theme is selected', () => {
  for (const theme of [null, 'modernist']) {
    const css = storyBaseCss({ chrome: false, theme, faces: [], fonts: { slots: {}, families: [] } });
    const root = css.match(/:root\s*\{([^}]*)\}/)?.[1];
    expect(root).toContain('color: var(--foreground, CanvasText)');
    expect(root).toContain('background-color: var(--background, Canvas)');
  }
});
