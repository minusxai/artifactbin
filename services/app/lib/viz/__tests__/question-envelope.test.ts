/**
 * The seam between the stored `viz` prop and the envelope the encoding helpers
 * edit. Two shapes for the same thing is exactly where data quietly goes
 * missing, so the round trip is pinned here rather than discovered as a chart
 * that lost its axis after someone changed a colour.
 */
import { describe, it, expect } from 'vitest';
import { vizPropToEnvelope, envelopeToVizProp, isEditableVizProp, datasetTypeToVizKind, vizColumn } from '../question-envelope';
import { setChannelField, getChannelField, setVizType, getVizType } from '../encoding-edit';

const BAR = {
  kind: 'vega-lite',
  spec: { mark: 'bar', encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'revenue', type: 'quantitative' } } },
};

describe('round trip', () => {
  it('preserves a chart through prop → envelope → prop', () => {
    expect(envelopeToVizProp(vizPropToEnvelope(BAR))).toEqual(BAR);
  });

  it('keeps spec keys the panel does not touch', () => {
    const withExtras = { kind: 'vega-lite', spec: { ...BAR.spec, title: 'Revenue', width: 400, config: { bar: { size: 12 } } } };
    const out = envelopeToVizProp(vizPropToEnvelope(withExtras));
    expect(out).toEqual(withExtras); // width/title/config survive an edit round trip
  });

  it('drops the reserved envelope namespaces on the way back', () => {
    // A story has no bindings/params/assets; letting them through would smuggle
    // unsupported keys into a stored artifact.
    const env = { ...vizPropToEnvelope(BAR), dataBindings: { a: 1 }, assets: { x: 'y' } } as never;
    expect(envelopeToVizProp(env)).toEqual(BAR);
  });
});

describe('composed specs survive the round trip', () => {
  // A layered spec (scatter + fitted trend line) has no TOP-LEVEL mark or
  // encoding, which the "no chart" check used to read as an empty spec — one
  // apply in the spec box and the whole viz vanished into a table.
  const LAYERED = {
    kind: 'vega-lite',
    spec: {
      layer: [
        { mark: { type: 'circle' }, encoding: { x: { field: 'score', type: 'quantitative' }, y: { field: 'comments', type: 'quantitative' } } },
        { mark: { type: 'line' }, encoding: { x: { field: 'score', type: 'quantitative' }, y: { field: 'fitted', type: 'quantitative' } } },
      ],
    },
  };

  it('a layered spec is a chart, not the "no chart" state', () => {
    expect(envelopeToVizProp(vizPropToEnvelope(LAYERED))).toEqual(LAYERED);
  });

  it('every composition operator counts as chart content', () => {
    for (const key of ['layer', 'hconcat', 'vconcat', 'concat', 'repeat', 'facet', 'spec']) {
      const prop = { kind: 'vega-lite', spec: { [key]: [] } };
      expect(envelopeToVizProp(vizPropToEnvelope(prop)), key).toEqual(prop);
    }
  });
});

describe('the "no chart yet" state', () => {
  it('lifts a missing prop into an editable empty envelope', () => {
    const env = vizPropToEnvelope(undefined);
    expect((env as { source: { kind: string } }).source.kind).toBe('vega-lite');
    expect(getVizType((env as { source: { spec: Record<string, unknown> } }).source.spec)).toBeNull();
  });

  it('flattens an empty spec back to undefined, so the Question renders a table', () => {
    // {kind:'vega-lite', spec:{}} would render an empty chart frame — broken
    // looking. Absent viz is the honest representation of "no chart".
    expect(envelopeToVizProp(vizPropToEnvelope(undefined))).toBeUndefined();
    expect(envelopeToVizProp(vizPropToEnvelope({ kind: 'vega-lite', spec: {} }))).toBeUndefined();
  });

  it('treats a table prop as editable — choosing a chart type is how you leave it', () => {
    expect(isEditableVizProp(undefined)).toBe(true);
    expect(isEditableVizProp({ kind: 'vega-lite', spec: {} })).toBe(true);
  });

  it('refuses kinds the panel cannot safely edit', () => {
    expect(isEditableVizProp({ kind: 'recipe', recipe: 'ref:rcpe01' })).toBe(false);
    expect(isEditableVizProp({ kind: 'vega', spec: {} })).toBe(false);
  });
});

describe('the helpers actually operate through the adapter', () => {
  it('sets a channel field and it lands in the stored prop', () => {
    const env = setChannelField(vizPropToEnvelope(BAR), 'x', vizColumn('quarter', 'string'));
    const prop = envelopeToVizProp(env)!;
    expect((prop.spec!.encoding as Record<string, { field: string }>).x.field).toBe('quarter');
    // and the untouched channel survives
    expect((prop.spec!.encoding as Record<string, { field: string }>).y.field).toBe('revenue');
  });

  it('clears a channel', () => {
    const env = setChannelField(vizPropToEnvelope(BAR), 'y', null);
    expect(getChannelField((envelopeToVizProp(env)!).spec as Record<string, unknown>, 'y')).toBeNull();
  });

  it('changes the chart type and keeps the fields', () => {
    const env = setVizType(vizPropToEnvelope(BAR), 'line');
    const prop = envelopeToVizProp(env)!;
    expect(getVizType(prop.spec as Record<string, unknown>)).toBe('line');
    expect((prop.spec!.encoding as Record<string, { field: string }>).x.field).toBe('region');
  });

  it('builds a chart from nothing — the first edit on a table Question', () => {
    let env = vizPropToEnvelope(undefined);
    env = setVizType(env, 'bar');
    env = setChannelField(env, 'x', vizColumn('region', 'string'));
    env = setChannelField(env, 'y', vizColumn('revenue', 'number'));
    const prop = envelopeToVizProp(env)!;
    expect(prop.kind).toBe('vega-lite');
    expect(getVizType(prop.spec as Record<string, unknown>)).toBe('bar');
    expect((prop.spec!.encoding as Record<string, { field: string }>).y.field).toBe('revenue');
  });
});

describe('dataset type → vega kind', () => {
  it('maps the four types a dataset can record', () => {
    // Datasets speak string|number|boolean|date; encodings speak
    // nominal|quantitative|boolean|temporal. A wrong mapping renders a flat
    // scale rather than an error, so each one is pinned.
    expect(datasetTypeToVizKind('number')).toBe('quantitative');
    expect(datasetTypeToVizKind('date')).toBe('temporal');
    expect(datasetTypeToVizKind('string')).toBe('nominal');
    expect(datasetTypeToVizKind('boolean')).toBe('boolean');
  });

  it('falls back to unknown rather than guessing quantitative', () => {
    expect(datasetTypeToVizKind(undefined)).toBe('unknown');
    expect(datasetTypeToVizKind('geo')).toBe('unknown');
  });

  it('vizColumn carries the name through', () => {
    expect(vizColumn('revenue', 'number')).toEqual({ name: 'revenue', kind: 'quantitative' });
  });
});
