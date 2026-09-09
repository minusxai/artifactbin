import { describe, it, expect } from 'vitest';
import { parseJsx } from '@/lib/jsx';
import { juneResolutionCorrect } from '../lib/score/june-resolution';
const rows = [
  { team: 'Core', channel: 'email', hours: 14.9 }, { team: 'Core', channel: 'chat', hours: 3.1 },
  { team: 'Billing', channel: 'email', hours: 21.5 }, { team: 'Billing', channel: 'chat', hours: 6.2 },
];
const markup = '<Question data="$resolution" viz={{kind:"vega-lite",spec:{mark:"bar",encoding:{x:{field:"team"},y:{field:"hours"},color:{field:"channel"}}}}} />';
function html(data: unknown[], chart = markup) {
  const parsed = parseJsx(chart); if (!parsed.ok) throw new Error(parsed.error);
  return `<script id="mx-story-data">${JSON.stringify({nodes: parsed.nodes, dataflow:{state:{tables:{resolution:{rows:data}}}}})}</script>`;
}
describe('June resolution semantics', () => {
  it('accepts all four directly supplied June medians in a bound chart, including aliased measures', () => {
    expect(juneResolutionCorrect(html(rows))).toBe(true);
    expect(juneResolutionCorrect(html(rows.map(({hours,...r})=>({...r,h:hours})),markup.replace('field:"hours"','field:"h"')))).toBe(true);
  });
  it('rejects averages of group medians and the wrong month despite valid rendering', () => {
    expect(juneResolutionCorrect(html(rows.map(r=>({...r,hours:13.04}))))).toBe(false);
    expect(juneResolutionCorrect(html(rows.map((r,i)=>({...r,hours:[16.4,3.7,23.1,6.9][i]}))))).toBe(false);
  });
  it('requires the correct results to be charted, not merely present in an unused query or a table', () => {
    expect(juneResolutionCorrect(html(rows,'<p>June medians</p>'))).toBe(false);
    expect(juneResolutionCorrect(html(rows,'<Question data="$resolution" viz={{kind:"table"}} />'))).toBe(false);
    expect(juneResolutionCorrect(html(rows,markup.replace('$resolution','$other')))).toBe(false);
  });
  it('rejects missing groups and missing or malformed evidence', () => {
    expect(juneResolutionCorrect(html(rows.slice(0,3)))).toBe(false);
    expect(juneResolutionCorrect('<p>Median: 14.9</p>')).toBe(false);
    expect(juneResolutionCorrect('<script id="mx-story-data">bad</script>')).toBe(false);
  });
});
