import { afterEach, describe, expect, it, vi } from 'vitest';
import { readEditChartObservation } from '../gates/lib/edit-chart-observation.mjs';

afterEach(() => vi.unstubAllGlobals());
function frame({ editing, marks, text = '' }) {
  vi.stubGlobal('document', {
    querySelector: (selector) => selector === '[contenteditable="true"]' && editing ? {} : null,
    querySelectorAll: (selector) => selector === 'svg.marks, canvas' ? Array(marks).fill({}) : [],
    body: { innerText: text },
  });
  return readEditChartObservation();
}
describe('chart edit-mode gate observation', () => {
  it('refuses reader marks and a new editor before its chart, then accepts the actual editor chart', () => {
    expect(frame({ editing: false, marks: 1, text: 'Reader chart' }).ready).toBe(false);
    expect(frame({ editing: true, marks: 0, text: 'Editor loading' }).ready).toBe(false);
    expect(frame({ editing: true, marks: 1, text: 'Editor chart' })).toEqual({ editing: true, marks: 1, text: 'Editor chart', ready: true });
  });
  it('retains unavailable text during loading, even when no edit host exists yet', () => {
    expect(frame({ editing: false, marks: 0, text: 'data unavailable' })).toMatchObject({ ready: false, text: 'data unavailable' });
  });
});
