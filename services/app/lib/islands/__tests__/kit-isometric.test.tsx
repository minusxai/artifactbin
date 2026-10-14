/* @jsxImportSource solid-js */
import { describe, expect, it } from 'vitest';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { Isometric } from '../kit/isometric';
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
      const before = host.querySelector('path')!.getAttribute('d');
      setSpread(1);
      expect(host.querySelector('path')!.getAttribute('d')).not.toBe(before);
      expect(svg.getAttribute('viewBox')).toBe(viewBox);
    } finally { dispose(); }
  });
});
