/* @jsxImportSource solid-js */
import { describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { Isometric } from '../kit/isometric-server';
import { IslandProvider } from '../context';
import { fakeIsland } from './context.test';
import type { IsometricPart } from '@/lib/jsx/isometric-spec';
const parts: IsometricPart[] = [{ key: 'shaft', kind: 'cylinder', x: 0, y: 0, z: 0, radius: 10, height: 30, separation: [0, 0, 60] }];
describe('Isometric figure', () => {
  it('renders an accessible static SVG without an island context', () => {
    const host = document.createElement('div');
    const dispose = render(() => <Isometric title="Shaft & bearing" parts={parts} />, host);
    try {
      expect(host.querySelector('svg')!.getAttribute('aria-label')).toBe('Shaft & bearing');
      expect(host.querySelector('title')!.textContent).toBe('Shaft & bearing');
      expect(host.querySelectorAll('path').length).toBeGreaterThan(3);
      expect(host.querySelector('canvas, img, script')).toBeNull();
    } finally { dispose(); }
  });
  it('moves the figure from the same Value used by its slider', () => {
    const host = document.createElement('div');
    const [spread, setSpread] = createSignal(0);
    const island = fakeIsland(); island.value = name => name === 'spread' ? spread() : undefined;
    const dispose = render(() => <IslandProvider value={island}><Isometric title="Shaft" parts={parts} spread="$spread" /></IslandProvider>, host);
    try {
      const svg = host.querySelector('svg')!, viewBox = svg.getAttribute('viewBox');
      const before = host.querySelector('[data-part]')!.getAttribute('transform');
      const path = host.querySelector('path')!;
      setSpread(1);
      expect(host.querySelector('[data-part]')!.getAttribute('transform')).not.toBe(before);
      expect(host.querySelector('path')).toBe(path);
      expect(svg.getAttribute('viewBox')).toBe(viewBox);
    } finally { dispose(); }
  });
  it('honours reduced motion and cancels an in-flight easing frame on disposal', () => {
    const host = document.createElement('div');
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    const original = Object.getOwnPropertyDescriptor(window, 'matchMedia');
    let reduced = true;
    const media = { get matches() { return reduced; }, addEventListener() {}, removeEventListener() {} };
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: () => media });
    const frames = new Map<number, FrameRequestCallback>(); let next = 0;
    const raf = vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++next, callback); return next; });
    const cancel = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    const [spread, setSpread] = createSignal(0);
    const island = fakeIsland(); island.value = () => spread();
    const dispose = render(() => <IslandProvider value={island}><Isometric title="Motion" parts={parts} spread="$spread" motion="smooth" /></IslandProvider>, host);
    try {
      const before = host.querySelector('[data-part]')!.getAttribute('transform');
      setSpread(1);
      expect(host.querySelector('[data-part]')!.getAttribute('transform')).not.toBe(before);
      expect(frames.size).toBe(0);
      reduced = false;
      setSpread(0);
      expect(frames.size).toBe(1);
      dispose();
      expect(frames.size).toBe(0);
    } finally {
      dispose(); raf.mockRestore(); cancel.mockRestore(); hidden.mockRestore();
      if (original) Object.defineProperty(window, 'matchMedia', original); else Reflect.deleteProperty(window, 'matchMedia');
    }
  });

});
