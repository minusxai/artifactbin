// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { AfIcon, registerIcon } from './icon';
import { iconMarkup, LUCIDE_ICON_COUNT } from './icon-glyphs';

registerIcon();
afterEach(() => document.body.replaceChildren());
const tick = async () => { await Promise.resolve(); await Promise.resolve(); };
function fixture(attrs = '', children = '') {
  const host = document.createElement('div'); host.innerHTML = `<af-icon ${attrs}>${children}</af-icon>`; document.body.append(host);
  const root = host.firstElementChild as AfIcon;
  return {root, svg: root.querySelector('svg')!};
}
describe('af-icon', () => {
  it('ships the full trusted Lucide name catalog, including aliases', () => {
    expect(LUCIDE_ICON_COUNT).toBe(2018);
    expect(iconMarkup('activity-square')).toContain('lucide-square-activity');
    expect(iconMarkup('grid-2x2')).toContain('lucide-grid-2x2');
  });
  it('normalizes kebab, snake, spaces and Pascal names and uses a visible unknown fallback', () => {
    const kebab = fixture('name="arrow-up-right"'); const pascal = fixture('name="ArrowUpRight"');
    expect(kebab.svg.querySelector('path')?.getAttribute('d')).toBe(pascal.svg.querySelector('path')?.getAttribute('d'));
    expect(fixture('name="arrow_up_right"').svg.querySelector('path')?.getAttribute('d')).toBe(kebab.svg.querySelector('path')?.getAttribute('d'));
    expect(fixture('name="not-a-real-glyph"').svg.querySelector('path')?.getAttribute('d')).toBe(iconMarkup('circle-question-mark').match(/<path\b[^>]*\bd="([^"]+)/)?.[1]);
  });
  it('applies size, stroke, theme and keeps glyph ink on currentColor', () => {
    const {root,svg} = fixture('name="activity" size="30" stroke-width="1.5" theme="dark"');
    expect(svg.getAttribute('width')).toBe('30'); expect(svg.getAttribute('height')).toBe('30');
    expect(svg.getAttribute('stroke-width')).toBe('1.5'); expect(svg.getAttribute('stroke')).toBe('currentColor');
    expect(svg.dataset.afTheme).toBe('dark');
    root.setAttribute('size','1.25em'); expect(svg.getAttribute('width')).toBe('1.25em');
    root.setAttribute('stroke-width','3'); expect(svg.getAttribute('stroke-width')).toBe('3');
  });
  it('keeps the stable host box, named SVG semantics, and source text baseline', () => {
    const {root, svg} = fixture('data-af-id="icon-anchor" name="circle-check" aria-label="Completed"');
    expect(svg.getAttribute('width')).toBe('16');
    expect(root.dataset.afId).toBe('icon-anchor');
    expect(getComputedStyle(root).display).toBe('inline-block');
    expect(getComputedStyle(root).verticalAlign).toBe('-0.125em');
    expect(getComputedStyle(svg).display).toBe('block');
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Completed');
  });
  it('is decorative by default and exposes an accessible name for explicit labels', () => {
    const {root,svg} = fixture('name="check"');
    expect(svg.getAttribute('aria-hidden')).toBe('true'); expect(svg.getAttribute('focusable')).toBe('false');
    root.setAttribute('label','Saved'); expect(svg.getAttribute('aria-label')).toBe('Saved');
    expect(svg.getAttribute('role')).toBe('img'); expect(svg.hasAttribute('aria-hidden')).toBe(false);
  });
  it('preserves authored host and child IDs and never parses authored markup as glyph data', () => {
    const {root,svg} = fixture('id="host" data-af-id="stable" name="check"', '<span id="child">authored</span>');
    expect(root.id).toBe('host'); expect(root.dataset.afId).toBe('stable'); expect(root.querySelector('#child')?.textContent).toBe('authored');
    root.setAttribute('name','<svg onload="alert(1)">');
    expect(root.querySelector('svg')).toBe(svg); expect(svg.querySelector('[onload]')).toBeNull(); expect(svg.querySelector('script')).toBeNull();
  });
  it('supports pre-upgrade name and size properties and reconnects without duplicate lifecycle effects', async () => {
    const host = document.createElement('div'); host.innerHTML = '<af-icon><span id="kept">kept</span></af-icon>';
    const root = host.firstElementChild as AfIcon; Object.defineProperties(root,{name:{value:'circle-check',writable:true,configurable:true},size:{value:28,writable:true,configurable:true}});
    document.body.append(host); expect(root.name).toBe('circle-check'); expect(root.querySelector('svg')?.getAttribute('width')).toBe('28');
    const svg = root.querySelector('svg'); root.remove(); host.append(root); await tick(); expect(root.querySelector('svg')).toBe(svg);
    root.name='circle-alert'; expect(root.querySelector('svg')?.classList.contains('lucide-circle-alert')).toBe(true);
    expect(root.querySelector('#kept')?.textContent).toBe('kept');
  });
  it('keeps multiple icons independent and installs its style once', () => {
    const one = fixture('name="check"'); const two = fixture('name="x" size="12"');
    expect(one.svg.getAttribute('width')).toBe('16'); expect(two.svg.getAttribute('width')).toBe('12');
    registerIcon(); expect(document.querySelectorAll('style[data-af-icon-styles]')).toHaveLength(1);
  });
});
