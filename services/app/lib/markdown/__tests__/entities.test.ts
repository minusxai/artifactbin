/**
 * The slim entity decoder (services/app/lib/markdown/entities.ts) and its wiring: in this runner markdown-it decodes
 * through it (a rare name stays as typed, in text, link addresses and info strings alike). The jsdom twin of this file
 * and bundle.test.ts check the same samples in a browser environment and in an esbuild bundle.
 */
import { describe, expect, it } from 'vitest';
import { parse, renderHtml } from '../display';
import { decodeHTML, decodeHTMLStrict } from '../entities';
import { ENTITY_HTML, ENTITY_SAMPLES } from './samples';

describe('the slim decoder', () => {
  it('decodes numeric and common named references and leaves the rest as typed', () => {
    expect(decodeHTML('&amp;&lt;&gt;&quot;&apos;&nbsp;&Tab;&NewLine;&colon;&copy;&euro;')).toBe('&<>"\' \t\n:©€');
    expect(decodeHTML('&#65;&#x42;&#0;&#xD800;&#1114112;&#128512;')).toBe('AB���😀');
    expect(decodeHTML('&alpha; &AMP; &amp &toString; &constructor; &__proto__;')).toBe('&alpha; &AMP; &amp &toString; &constructor; &__proto__;');
    expect(decodeHTMLStrict).toBe(decodeHTML);
  });
});

describe('markdown-it decodes through it here', () => {
  it.each(ENTITY_SAMPLES.map((sample, i) => [sample, ENTITY_HTML[i]!]))('%j', (sample, expected) => {
    expect(renderHtml(parse(sample))).toBe(expected);
  });
  it('keeps a rare name in a code block info string as typed', () => {
    expect(parse('```&alpha;\nx\n```').content[0]!.attrs).toEqual({ language: '&alpha;' });
  });
});
