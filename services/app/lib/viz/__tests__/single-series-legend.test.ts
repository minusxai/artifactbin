/**
 * The single-series legend injection vs an author's explicit mark color.
 *
 * The injection gives a colorless unit chart a constant color datum so it grows
 * a one-entry legend — but an ENCODING beats the mark in Vega-Lite, so injecting
 * it over a spec whose mark says `color`/`fill` silently repaints the author's
 * choice with the theme palette. That is exactly the edit the raw spec surface
 * invites ("experiment with colors"), so it must win.
 */
import { describe, it, expect } from 'vitest';
import { injectSingleSeriesLegend } from '../render-vega';

const bar = (mark: unknown) => ({
  mark,
  encoding: {
    x: { field: 'month', type: 'nominal' },
    y: { field: 'posts', type: 'quantitative' },
  } as Record<string, Record<string, unknown>>,
});

describe('injectSingleSeriesLegend', () => {
  it('gives a colorless unit chart a constant color datum named after the measure', () => {
    const spec = bar('bar');
    injectSingleSeriesLegend(spec);
    expect(spec.encoding.color).toEqual({ datum: 'posts' });
  });

  it('leaves an author color encoding untouched', () => {
    const spec = bar('bar');
    spec.encoding.color = { field: 'region', type: 'nominal' };
    injectSingleSeriesLegend(spec);
    expect(spec.encoding.color).toEqual({ field: 'region', type: 'nominal' });
  });

  it('stays out of the way when the MARK carries an explicit color', () => {
    const spec = bar({ type: 'bar', color: '#e4572e' });
    injectSingleSeriesLegend(spec);
    expect(spec.encoding.color).toBeUndefined();
  });

  it('stays out of the way when the mark carries an explicit fill', () => {
    const spec = bar({ type: 'bar', fill: '#e4572e' });
    injectSingleSeriesLegend(spec);
    expect(spec.encoding.color).toBeUndefined();
  });
});
