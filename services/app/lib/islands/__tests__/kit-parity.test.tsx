/* @jsxImportSource solid-js */
/**
 * The parity helper works inside the islands project: the retired React kit renders through the interpreter
 * (Vite's react-jsx transform, the Solid transform scoped to lib/islands), a Solid render is compared
 * to it, and a difference is reported rather than passing silently.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { applyCurrentSlideLayout, parityOf, reactRender } from './kit-parity';

describe('kit parity helper', () => {
  it('renders today\'s kit and finds no difference against the same DOM', () => {
    const html = reactRender('<Badge>New</Badge>');
    expect(html).toMatch(/<span[^>]*>New<\/span>/);
    expect(parityOf('<Badge>New</Badge>', html)).toEqual([]);
  });

  it('reports a Solid render that differs', () => {
    const host = document.createElement('div');
    const dispose = render(() => <div class="rounded">New</div>, host);
    expect(parityOf('<Badge>New</Badge>', host.innerHTML).join('\n')).toMatch(/tag span vs div/);
    dispose();
  });

  it('applies the current sizing recipe only to captured Slide roots', () => {
    const captured = '<section data-mx-slide class="relative flex flex-col min-h-[var(--mx-vh,760px)] py-4"></section>'
      + '<div class="relative flex flex-col min-h-[var(--mx-vh,760px)] py-4"></div>';
    const adapted = applyCurrentSlideLayout(captured);
    expect(adapted).toBe(
      '<section data-mx-slide="" class="relative flex w-full min-w-0 flex-col min-h-[var(--mx-vh,760px)] py-4"></section>'
      + '<div class="relative flex flex-col min-h-[var(--mx-vh,760px)] py-4"></div>',
    );
    expect(applyCurrentSlideLayout(adapted)).toBe(adapted);
  });

  it('preserves captured non-Slide markup byte for byte', () => {
    const captured = '<span data-slot="badge" class="[a&]:hover:bg-primary/90">New</span>\n';
    expect(applyCurrentSlideLayout(captured)).toBe(captured);
  });
});
