import {describe,it,expect} from 'vitest';
import {beginChartRender} from '../render-readiness';

describe('chart readiness across overlapping renders',()=>{
 it('stays pending until both initial rendering and a data update finish',()=>{
  const chart=document.createElement('div');
  const initial=beginChartRender(chart),update=beginChartRender(chart);
  initial();expect(chart.dataset.mxChartState).toBe('pending');
  update();expect(chart.dataset.mxChartState).toBe('ready');
 });
 it('a cancelled operation can settle twice without clearing newer work',()=>{
  const chart=document.createElement('div'),old=beginChartRender(chart);old();
  const next=beginChartRender(chart);old();expect(chart.dataset.mxChartState).toBe('pending');
  next();expect(chart.dataset.mxChartState).toBe('ready');
 });
});
