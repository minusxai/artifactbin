/**
 * Authored `<style>` blocks — interpreter render. The CSS travels as a
 * template-literal child (the JSX idiom that keeps `{`/`}` as data); the
 * interpreter must render it as a real <style> node inside the surface so the
 * capture path (which serializes in-root styles) carries it for free.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderStoryNodes } from '../interpreter';
import { parseJsxOrThrow } from '@/test/helpers/jsx';

const mount = (src: string) => {
  const parsed = parseJsxOrThrow(src);
  return render(<>{renderStoryNodes(parsed.nodes, { components: {} })}</>);
};

describe('authored <style> rendering', () => {
  it('renders a style element whose text is the authored CSS', () => {
    const { container } = mount(
      '<style>{`@keyframes rise { from { opacity: 0 } } .rise { animation: rise 1s both }`}</style><p className="rise">x</p>',
    );
    const style = container.querySelector('style');
    expect(style).not.toBeNull();
    expect(style!.textContent).toContain('@keyframes rise');
    expect(style!.textContent).toContain('.rise');
  });
});
