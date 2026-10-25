import {describe,expect,it} from 'vitest';
import {nativeHtmlStructuralWrapper} from '../serving/native-html-structural-wrapper';

describe('nativeHtmlStructuralWrapper typography baseline',()=>{
 it('provides the source bare-text defaults only to an unstyled inline-story document root',()=>{
  const source='<html><head></head><body><div data-mx-story-root data-mx-inline-story><div class="mx-doc"><p>Story</p></div></div></body></html>';
  const rendered=nativeHtmlStructuralWrapper(source);
  expect(rendered).toContain(':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled])) :where(p,ul,ol,blockquote,table,pre):not([class]){margin-block:0.75em;max-width:68ch;line-height:1.65}');
  expect(rendered).not.toContain(':where([data-mx-story-root])');
  expect(rendered).toContain(':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled])>.mx-doc){line-height:1.5}');
  expect(rendered).toContain('<p>Story</p>');
  expect(nativeHtmlStructuralWrapper(rendered)).toBe(rendered);
 });

 it('does not add story typography to unrelated or already styled roots',()=>{
  const unrelated='<html><head></head><body><div><div class="mx-doc"><p>Authored HTML</p></div></div></body></html>';
  const styled='<html><head></head><body><div data-mx-story-root data-mx-inline-story data-mx-styled><div class="mx-doc"><p>Styled story</p></div></div></body></html>';
  expect(nativeHtmlStructuralWrapper(unrelated)).toBe(unrelated);
  expect(nativeHtmlStructuralWrapper(styled)).toBe(styled);
 });

 it('preserves authored CSS and nested inline spacing',()=>{
  const source='<html><head><style>.mx-doc p{line-height:2}</style></head><body><div data-mx-story-root data-mx-inline-story><div class="mx-doc"><p style="line-height:2;padding:7px">Authored</p></div></div></body></html>';
  const rendered=nativeHtmlStructuralWrapper(source);
  expect(rendered).toContain('.mx-doc p{line-height:2}');
  expect(rendered).toContain('style="line-height:2;padding:7px"');
  expect(rendered.indexOf('data-mx-native-html-presentation')).toBeLessThan(rendered.indexOf('.mx-doc p{line-height:2}'));
  expect(rendered).toContain(':where([data-mx-story-root][data-mx-inline-story]:not([data-mx-styled])>.mx-doc){line-height:1.5}');
 });

 it('reuses an existing bare-type sheet instead of duplicating its rules',()=>{
  const source='<html><head><style data-mx-bare-type>source-owned-bare-rules</style></head><body><div data-mx-story-root data-mx-inline-story><div class="mx-doc"><p>Story</p></div></div></body></html>';
  const rendered=nativeHtmlStructuralWrapper(source);
  expect(rendered).toContain('source-owned-bare-rules');
  expect(rendered).not.toContain('max-width:68ch');
  expect(rendered).toContain('data-mx-native-html-presentation');
 });

 it('recognizes a linked bare-type sheet as an existing reader default',()=>{
  const source='<html><head><link rel="stylesheet" data-mx-bare-type href="/assets/bare.css"></head><body><div data-mx-story-root data-mx-inline-story><div class="mx-doc"><p>Story</p></div></div></body></html>';
  const rendered=nativeHtmlStructuralWrapper(source);
  expect(rendered).not.toContain('max-width:68ch');
  expect(rendered).toContain('href="/assets/bare.css"');
 });
});
