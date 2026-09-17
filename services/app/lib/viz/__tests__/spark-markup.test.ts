/**
 * The sparkline's DRAWING RULES, extracted from components/ui's `Spark` so the
 * document kit can draw the same mark (components/kit/files) without importing
 * app chrome — which lib/__tests__/reader-bundle-hygiene forbids.
 *
 * Every rule here was already in `Spark`; this pins them where both callers can
 * see them. The one addition is the `data-sparkline` stamp and what it implies:
 * the answer is ALWAYS one `<svg>` element, so a caller can find the picture it
 * drew without knowing what the server put inside it.
 */
import { describe, expect, it } from 'vitest';
import { sparklineSvg } from '@/lib/viz/spark-markup';

const VEGA = '<svg width="96" height="20"><g><path d="M0 10L96 2" fill="#3fe77b" fill-opacity="0.18" stroke="#3fe77b"/></g></svg>';

describe('sparklineSvg', () => {
  it('stamps the picture and makes it fluid', () => {
    const out = sparklineSvg(VEGA);
    expect(out.startsWith('<svg')).toBe(true);
    expect(out).toContain('data-sparkline=""');
    // The fixed pixel size becomes a box, so one 96x20 render serves every size.
    expect(out).toContain('viewBox="0 0 96 20"');
    expect(out).toContain('preserveAspectRatio="none"');
    expect(out).toContain('<path');
  });

  it('keeps a viewBox and a preserveAspectRatio the source already carries', () => {
    const out = sparklineSvg('<svg viewBox="0 0 4 2" preserveAspectRatio="xMidYMid"><path d="M0 0"/></svg>');
    expect(out.match(/viewBox=/g)).toHaveLength(1);
    expect(out).toContain('preserveAspectRatio="xMidYMid"');
  });

  it('gives every path a non-scaling stroke, once', () => {
    // The stretch is non-uniform, and a stroke scales with the geometry it
    // rides: without this a spike drew ~5x fatter than the flat baseline.
    expect(sparklineSvg(VEGA)).toContain('vector-effect="non-scaling-stroke"');
    const twice = sparklineSvg('<svg width="1" height="1"><path vector-effect="non-scaling-stroke" d="M0 0"/></svg>');
    expect(twice.match(/vector-effect/g)).toHaveLength(1);
  });

  it('drops the area fill when the caller asks for line only', () => {
    expect(sparklineSvg(VEGA, { filled: false })).toContain('fill-opacity="0"');
    expect(sparklineSvg(VEGA, { filled: true })).toContain('fill-opacity="0.18"');
  });

  it('answers an EMPTY picture for anything that is not a rendered spline', () => {
    // The value reaches <Files> from a document's own <Query>, so a row
    // carrying something else must draw nothing rather than inject it — and the
    // element still exists, because the caller reserved space for a picture.
    expect(sparklineSvg('0,1,3,2')).toBe('<svg data-sparkline="" preserveAspectRatio="none"></svg>');
    expect(sparklineSvg('<img src=x onerror=alert(1)>')).toBe('<svg data-sparkline="" preserveAspectRatio="none"></svg>');
    expect(sparklineSvg('')).toBe('<svg data-sparkline="" preserveAspectRatio="none"></svg>');
  });
});
