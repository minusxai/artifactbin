import {expect, it} from 'vitest';
import {controlsClipPath} from '../controls-regions';

it('clips to the union of trusted controls, clamped to the viewport', () => {
  expect(controlsClipPath([{x:-5,y:0,width:110,height:40},{x:80,y:80,width:40,height:40}],100,100))
    .toBe('path("M0 0H100V40H0Z M80 80H100V100H80Z")');
});
it('fails closed for malformed, nonfinite or excessive geometry', () => {
  for (const input of [null,{},[{x:NaN,y:0,width:1,height:1}],Array(257).fill({x:0,y:0,width:1,height:1})]) {
    expect(controlsClipPath(input,100,100)).toBe('inset(100%)');
  }
  expect(controlsClipPath([{x:1000,y:0,width:5,height:5}],100,100)).toBe('inset(100%)');
});
