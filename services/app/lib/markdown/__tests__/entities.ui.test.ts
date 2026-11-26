/** entities.test.ts's samples in jsdom, where browser-resolved packages are used: the same markup as in Node. */
import { expect, it } from 'vitest';
import { parse, renderHtml } from '../display';
import { ENTITY_HTML, ENTITY_SAMPLES } from './samples';

it.each(ENTITY_SAMPLES.map((sample, i) => [sample, ENTITY_HTML[i]!]))('decodes %j as in Node', (sample, expected) => {
  expect(renderHtml(parse(sample))).toBe(expected);
});
