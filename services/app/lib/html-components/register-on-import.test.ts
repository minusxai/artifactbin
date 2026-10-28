// @vitest-environment jsdom
import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it, vi } from 'vitest';

// Every user-facing module: a bare import defines these tags and injects this stylesheet.
const components: Record<string, { style?: string; tags: string[] }> = {
  accordion: { style: 'af-accordion-styles', tags: ['af-accordion', 'af-accordion-item', 'af-accordion-trigger', 'af-accordion-content'] },
  avatar: { style: 'af-avatar-styles', tags: ['af-avatar', 'af-avatar-image', 'af-avatar-fallback', 'af-avatar-badge', 'af-avatar-group', 'af-avatar-group-count'] },
  button: { style: 'af-button-styles', tags: ['af-button'] },
  collapsible: { style: 'af-collapsible-styles', tags: ['af-collapsible', 'af-collapsible-trigger', 'af-collapsible-content'] },
  'data-table': { style: 'af-data-table-styles', tags: ['af-data-table'] },
  'date-picker': { style: 'af-date-picker-styles', tags: ['af-date-picker'] },
  'deck-gl': { tags: ['af-deck-gl'] },
  dialog: { style: 'af-dialog-styles', tags: ['af-dialog', 'af-dialog-trigger', 'af-dialog-content', 'af-dialog-header', 'af-dialog-footer', 'af-dialog-title', 'af-dialog-description', 'af-dialog-close'] },
  'file-upload': { style: 'af-file-upload-styles', tags: ['af-file-upload'] },
  icon: { style: 'af-icon-styles', tags: ['af-icon'] },
  input: { style: 'af-input-styles', tags: ['af-input'] },
  isometric: { tags: ['af-isometric'] },
  markdown: { style: 'af-markdown-styles', tags: ['af-markdown'] },
  mermaid: { style: 'af-mermaid-styles', tags: ['af-mermaid'] },
  popover: { style: 'af-popover-styles', tags: ['af-popover', 'af-popover-trigger', 'af-popover-content', 'af-popover-anchor', 'af-popover-header', 'af-popover-title', 'af-popover-description'] },
  progress: { style: 'af-progress-styles', tags: ['af-progress'] },
  segmented: { style: 'af-segmented-styles', tags: ['af-segmented'] },
  select: { style: 'af-select-styles', tags: ['af-select'] },
  'slide-deck': { style: 'af-slide-deck-styles', tags: ['af-slide-deck', 'af-slide'] },
  slider: { style: 'af-slider-styles', tags: ['af-slider'] },
  switch: { style: 'af-switch-styles', tags: ['af-switch'] },
  tabs: { style: 'af-tabs-styles', tags: ['af-tabs', 'af-tabs-list', 'af-tabs-trigger', 'af-tabs-content'] },
  textarea: { style: 'af-textarea-styles', tags: ['af-textarea'] },
  tooltip: { style: 'af-tooltip-styles', tags: ['af-tooltip', 'af-tooltip-provider', 'af-tooltip-trigger', 'af-tooltip-content'] },
  user: { style: 'af-user-styles', tags: ['af-user'] },
};
const helpers = ['accordion-model', 'date-calendar', 'deck-gl-engine', 'deck-gl-model', 'file-upload-model', 'floating-geometry', 'floating-position', 'icon-glyphs', 'isometric-model', 'register-component', 'select-model', 'slide-navigation', 'tab-navigation', 'table-model', 'text-control'];
const load = (name: string): Promise<Record<string, unknown>> => import(`./${name}.ts`);
const define = vi.spyOn(customElements, 'define');
const baselineStyles = document.querySelectorAll('style').length;
const styleCount = () => document.querySelectorAll('style').length - baselineStyles;

it('lists every component source in the folder', () => {
  const sources = readdirSync(dirname(fileURLToPath(import.meta.url))).filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts')).map(file => file.slice(0, -3)).sort();
  expect(sources).toEqual([...Object.keys(components), ...helpers].sort());
});

it('helper modules define nothing and inject no styles on import', async () => {
  for (const name of helpers) await load(name);
  expect(define).not.toHaveBeenCalled();
  expect(styleCount()).toBe(0);
});

it('importing a component defines its tags and injects its stylesheet exactly once, exporting no register*', async () => {
  for (const [name, { style, tags }] of Object.entries(components)) {
    const module = await load(name);
    for (const tag of tags) expect(customElements.get(tag), tag).toBeDefined();
    if (style) expect(document.querySelectorAll(`style[data-${style}]`), name).toHaveLength(1);
    expect(Object.keys(module).filter(key => key.startsWith('register')), name).toEqual([]);
  }
  const defined = define.mock.calls.map(([tag]) => tag).sort();
  expect(defined).toEqual(Object.values(components).flatMap(({ tags }) => tags).sort());
  expect(styleCount()).toBe(Object.values(components).filter(({ style }) => style).length);
});

it('re-evaluated components sharing floating helpers define nothing twice and do not throw', async () => {
  const before = { defines: define.mock.calls.length, styles: styleCount() };
  for (const name of ['popover', 'tooltip', 'select']) {
    vi.resetModules();
    await expect(load(name)).resolves.toBeDefined();
  }
  await Promise.all(['popover', 'tooltip', 'select', 'date-picker'].map(load));
  expect(define.mock.calls.length).toBe(before.defines);
  expect(styleCount()).toBe(before.styles);
  for (const name of ['af-popover-styles', 'af-tooltip-styles', 'af-select-styles']) expect(document.querySelectorAll(`style[data-${name}]`)).toHaveLength(1);
});
