/**
 * questionEmbedHeightPx — the ONE <Question> sizing contract, shared by the editor canvas
 * (StoryJsxBody) and the served view document (StoryRuntimeApp). Before it was shared each
 * renderer had its own defaults (430 vs 320) and only one parsed string heights — the same
 * chart changed size between editing and reading.
 */
import {
  questionEmbedHeightPx, MIN_CHART_H, DEFAULT_CHART_H, SINGLE_VALUE_MIN_H, SINGLE_VALUE_DEFAULT_H,
} from '../question-height';

describe('questionEmbedHeightPx', () => {
  it('missing height takes the documented default (430 chart / 120 bare)', () => {
    expect(questionEmbedHeightPx(undefined, false)).toBe(DEFAULT_CHART_H);
    expect(questionEmbedHeightPx(undefined, true)).toBe(SINGLE_VALUE_DEFAULT_H);
    expect(DEFAULT_CHART_H).toBe(430);
    expect(SINGLE_VALUE_DEFAULT_H).toBe(120);
  });

  it('numbers pass through above the floor and clamp below it', () => {
    expect(questionEmbedHeightPx(500, false)).toBe(500);
    expect(questionEmbedHeightPx(100, false)).toBe(MIN_CHART_H);
    expect(questionEmbedHeightPx(20, true)).toBe(SINGLE_VALUE_MIN_H);
    expect(questionEmbedHeightPx(64, true)).toBe(64);
  });

  it('string heights parse ("400", "400px")', () => {
    expect(questionEmbedHeightPx('400', false)).toBe(400);
    expect(questionEmbedHeightPx('400px', false)).toBe(400);
    expect(questionEmbedHeightPx('60px', true)).toBe(60);
  });

  it('garbage takes the default', () => {
    expect(questionEmbedHeightPx('tall', false)).toBe(DEFAULT_CHART_H);
    expect(questionEmbedHeightPx(null, false)).toBe(DEFAULT_CHART_H);
    expect(questionEmbedHeightPx({}, true)).toBe(SINGLE_VALUE_DEFAULT_H);
  });
});
