/* @jsxImportSource solid-js */
/**
 * The parity helper works inside the islands project: the retired React kit renders through the interpreter
 * (Vite's react-jsx transform, the Solid transform scoped to lib/islands), a Solid render is compared
 * to it, and a difference is reported rather than passing silently.
 */
import { describe, expect, it } from 'vitest';
import { render } from 'solid-js/web';
import { applyCurrentLayoutContracts, diffShapes, parityOf, reactRender, shapeOf } from './kit-parity';

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
    const adapted = applyCurrentLayoutContracts(captured);
    expect(adapted).toBe(
      '<section data-mx-slide="" class="relative flex w-full min-w-0 flex-col min-h-[var(--mx-vh,760px)] py-4"></section>'
      + '<div class="relative flex flex-col min-h-[var(--mx-vh,760px)] py-4"></div>',
    );
    expect(applyCurrentLayoutContracts(adapted)).toBe(adapted);
  });

  it('preserves captured non-Slide markup byte for byte', () => {
    const captured = '<span data-slot="badge" class="[a&]:hover:bg-primary/90">New</span>\n';
    expect(applyCurrentLayoutContracts(captured)).toBe(captured);
  });

  it('applies the DataTable wrapper min-width contract idempotently', () => {
    const captured = '<section><div aria-label="DataTable embed" style="width:100%"></div><span class="[a&]:hover:bg-primary/90">New</span></section>\n';
    const adapted = applyCurrentLayoutContracts(captured);
    expect(adapted).toBe('<section><div aria-label="DataTable embed" style="width:100%;min-width:0"></div><span class="[a&]:hover:bg-primary/90">New</span></section>\n');
    expect(applyCurrentLayoutContracts(adapted)).toBe(adapted);
    const broken = adapted.replace('min-width:0', 'min-width:1px');
    const brokenStyleDiff = diffShapes(shapeOf(adapted), shapeOf(broken)).join('\n');
    expect(brokenStyleDiff).toContain('min-width:0');
    expect(brokenStyleDiff).toContain('min-width:1px');
  });
});
