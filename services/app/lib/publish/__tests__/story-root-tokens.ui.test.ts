/**
 * THE STORY ROOT RESOLVES ITS DESIGN'S TOKENS, IN BOTH MODES. A compiled page names its design and mode on `<html>`
 * (lib/page-styles/document-root) and stamps the same pair on its story root (lib/compiled-page/story-element); every
 * element inside the story root must then resolve the tokens the document root does: the design system's own dark
 * palette in dark, its light one in light, the neutral pair without a design. The neutral `.dark` block once matched the
 * story root's mode class and re-declared every token beneath it, so a dark Phosphor page drew its kit in neutral grey.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as cssTree from '@/lib/mermaid-images/css-parser';
import { compileStoryCss } from '@/lib/data/story/story-css.server';
import { STORY_THEMES } from '@/lib/data/story/story-themes';
import { STORY_SYSTEMS } from '@/lib/data/story/story-systems';
import { documentRootAttributes } from '@/lib/page-styles/document-root';
import { inlineStoryElement } from '@/lib/compiled-page/story-element';
import { parseJsxOrThrow } from '@/test/helpers/jsx';
import { readerStorySheet } from '../prepared/reader-sheet.server';

const SOURCE = '<div className="rounded-xl bg-card p-4"><button className="bg-primary text-primary-foreground">Go</button></div>';
const BODY = '<div class="rounded-xl bg-card p-4"><button class="bg-primary text-primary-foreground">Go</button></div>';
const DESIGNS = [...STORY_SYSTEMS, ...STORY_THEMES];

let full = '';
beforeAll(async () => { full = (await compileStoryCss(SOURCE, { force: true }))!; });

/** The neutral dark palette's declarations, read off the compiled sheet: the rule that sets `--background` under `.dark`. */
function neutralDark(css: string): Record<string, string> {
  const out: Record<string, string> = {};
  cssTree.walk(cssTree.parse(css), {
    visit: 'Rule',
    enter(rule: cssTree.Rule) {
      const selector = cssTree.generate(rule.prelude);
      if (!selector.startsWith('.dark') || selector.includes(' ') || selector.includes(',')) return;
      rule.block.children.forEach((decl) => { if (decl.type === 'Declaration' && decl.property.startsWith('--')) out[decl.property] = cssTree.generate(decl.value).trim(); });
    },
  });
  return out;
}

/**
 * The sheet's token layer: every rule's custom-property declarations, selectors and order untouched. jsdom's CSS parser
 * refuses a compiled Tailwind sheet whole, and no other declaration bears on what a custom property resolves to.
 */
function tokenLayer(css: string): string {
  const out: string[] = [];
  cssTree.walk(cssTree.parse(css), {
    visit: 'Rule',
    enter(rule: cssTree.Rule) {
      if (this.atrule) return;
      const decls: string[] = [];
      rule.block.children.forEach((decl) => { if (decl.type === 'Declaration' && decl.property.startsWith('--')) decls.push(cssTree.generate(decl)); });
      if (decls.length) out.push(`${cssTree.generate(rule.prelude)}{${decls.join(';')}}`);
    },
  });
  return out.join('\n');
}

/** Draw the page the assembler serves (design and mode on `<html>` and on the story root) under `css`; the button inside. */
function page(css: string, mode: 'light' | 'dark', theme: string | null, authorCss = ''): { html: HTMLElement; button: HTMLElement } {
  const attrs = documentRootAttributes(mode, theme);
  const html = document.documentElement;
  for (const name of [...html.getAttributeNames()]) html.removeAttribute(name);
  const probe = document.createElement('div');
  probe.innerHTML = `<span ${attrs}></span>`;
  for (const name of probe.firstElementChild!.getAttributeNames()) html.setAttribute(name, probe.firstElementChild!.getAttribute(name)!);
  document.head.innerHTML = `<style>${tokenLayer(css)}</style>${authorCss ? `<style>${authorCss}</style>` : ''}`;
  document.body.innerHTML = inlineStoryElement(BODY, mode, theme);
  return { html, button: document.body.querySelector('button')! };
}
const read = (el: Element, token: string): string => getComputedStyle(el).getPropertyValue(token).trim();

describe('every element inside the story root resolves the document root\'s tokens', () => {
  it('every design\'s dark palette declares every token the neutral dark palette does', () => {
    const neutral = Object.keys(neutralDark(full));
    expect(neutral).toEqual(expect.arrayContaining(['--background', '--primary', '--card', '--chart-1']));
    for (const design of DESIGNS) expect(neutral.filter((token) => !(token in design.darkCssVars)), design.name).toEqual([]);
  });

  for (const sheet of ['full', 'reader'] as const) {
    const cssFor = (theme: string | null) => (sheet === 'full' ? full : readerStorySheet(full, { source: SOURCE, nodes: parseJsxOrThrow(SOURCE).nodes, theme })!);

    it(`${sheet} sheet, dark: a design system's dark tokens reach the button, for every system and theme`, () => {
      const neutral = neutralDark(full);
      for (const design of DESIGNS) {
        const { html, button } = page(cssFor(design.name), 'dark', design.name);
        expect(read(html, '--primary'), `${design.name} root`).toBe(design.darkCssVars['--primary']);
        for (const token of Object.keys(neutral)) expect(read(button, token), `${design.name} ${token}`).toBe(read(html, token));
        expect(read(button, '--primary'), design.name).toBe(design.darkCssVars['--primary']);
        expect(read(button, '--card'), design.name).toBe(design.darkCssVars['--card']);
      }
    });

    it(`${sheet} sheet, light: a design system's light tokens reach the button`, () => {
      for (const design of DESIGNS) {
        const { button } = page(cssFor(design.name), 'light', design.name);
        expect(read(button, '--primary'), design.name).toBe(design.cssVars['--primary']);
        expect(read(button, '--card'), design.name).toBe(design.cssVars['--card']);
      }
    });

    it(`${sheet} sheet: a page without a design keeps the neutral pair`, () => {
      const neutral = neutralDark(full);
      const dark = page(cssFor(null), 'dark', null);
      expect(read(dark.button, '--primary')).toBe(neutral['--primary']);
      expect(read(dark.button, '--card')).toBe(neutral['--card']);
      const light = page(cssFor(null), 'light', null);
      expect(read(light.button, '--primary')).not.toBe(neutral['--primary']);
    });
  }

  it('an authored `:root` override reaches the story root in dark too (the documented override contract)', () => {
    for (const name of ['phosphor', 'meridian', 'volta']) {
      const { button } = page(full, 'dark', name, ':root { --primary: #123456; }');
      expect(read(button, '--primary'), name).toBe('#123456');
    }
  });

  it('an authored `.dark` override still wins over a design system in dark', () => {
    const { button } = page(full, 'dark', 'phosphor', '.dark { --primary: #654321; }');
    expect(read(button, '--primary')).toBe('#654321');
  });
});
