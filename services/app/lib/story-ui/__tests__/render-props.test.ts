/**
 * ONE MARKUP POLICY: validation at publish (lib/jsx/validate) refuses event handlers, denied attributes and
 * dangerous URL schemes; the renderer (interpreter-primitives `rawBuildProps`) only renders what passed — the
 * `style` string as an object and the controlled props as their uncontrolled forms — and re-checks nothing.
 */
import { describe, expect, it } from 'vitest';
import { parseJsx, validateJsxSource, type JsxElement } from '@/lib/jsx';
import { JSX_STORY_COMPONENT_NAMES } from '@/lib/jsx/components';
import { STORY_HTML_TAGS } from '@/lib/jsx/component-names';
import { rawBuildProps } from '@/lib/story-ui/interpreter-primitives';

const validate = (src: string) => validateJsxSource(src, JSX_STORY_COMPONENT_NAMES, STORY_HTML_TAGS, 'no-inline-style');
const propsOf = (src: string) => {
  const node = (parseJsx(src) as { nodes: JsxElement[] }).nodes[0]!;
  return rawBuildProps(node.attributes, node.isComponent, node.tag, '0', undefined, {});
};

describe('publish validation is the policy', () => {
  it('refuses handlers, dangerous schemes and external SVG paint before anything is stored', () => {
    for (const src of [
      '<button onClick="alert(1)">x</button>',
      '<a href="javascript:alert(1)">x</a>',
      '<a href=" jav&#x09;ascript:alert(1)">x</a>',
      '<img src="data:text/html,<b>x</b>" alt="" />',
      '<svg><rect fill="url(https://evil.example/p.svg#a)" /></svg>',
    ]) expect(validate(src).length, src).toBeGreaterThan(0);
  });
});

describe('the renderer only renders', () => {
  it('writes an attribute as authored, with no second policy of its own', () => {
    // Markup that never reaches the renderer (validation refused it above) is not filtered here either.
    expect(propsOf('<a href="javascript:alert(1)" title="t">x</a>')).toMatchObject({ href: 'javascript:alert(1)', title: 't' });
    expect(propsOf('<svg fill="url(https://evil.example/p.svg#a)" />')).toMatchObject({ fill: 'url(https://evil.example/p.svg#a)' });
    expect(propsOf('<a href="https://example.com/a" target="_blank">x</a>')).toMatchObject({ href: 'https://example.com/a', target: '_blank' });
  });

  it('keeps the rendering concerns: the style string as an object, HTML spellings, controlled → uncontrolled', () => {
    expect(propsOf('<div class="a" style="margin-top: 4px; --x: 1; -webkit-line-clamp: 2" />')).toMatchObject({
      className: 'a', style: { marginTop: '4px', '--x': '1', WebkitLineClamp: '2' },
    });
    expect(propsOf('<label for="f">l</label>')).toMatchObject({ htmlFor: 'f' });
    expect(propsOf('<input type="checkbox" checked value="on" />')).toMatchObject({ defaultChecked: true, defaultValue: 'on' });
    expect(propsOf('<Tabs value="a"></Tabs>')).toMatchObject({ defaultValue: 'a' });
    expect(propsOf('<TabsTrigger value="a">A</TabsTrigger>')).toMatchObject({ value: 'a' });
  });

  it('carries the authored source ID separately from the runtime DOM ID', () => {
    expect(propsOf('<p id="row-template">a row</p>')).toMatchObject({ id: 'row-template', 'data-mx-source-node-id': 'row-template' });
  });

  it('sends the document origin to a YouTube player, which refuses to play without a referrer, and to no other frame', () => {
    for (const src of ['https://www.youtube.com/embed/abc', 'https://www.youtube-nocookie.com/embed/abc?start=5']) {
      expect(propsOf(`<iframe src="${src}" title="t" />`), src).toMatchObject({ referrerpolicy: 'strict-origin-when-cross-origin' });
    }
    for (const src of ['https://player.vimeo.com/video/1', 'https://www.loom.com/embed/1', 'https://www.youtube.com.evil.example/embed/abc']) {
      expect(propsOf(`<iframe src="${src}" title="t" />`), src).not.toHaveProperty('referrerpolicy');
    }
    expect(propsOf('<a href="https://www.youtube.com/watch?v=abc">x</a>')).not.toHaveProperty('referrerpolicy');
  });
});
