import {expect,it} from 'vitest';
import {floatingPosition} from './floating-geometry';
it('flips away from the viewport edge and clamps oversized content', () => {
 expect(floatingPosition({left:90,top:90,width:10,height:10},{width:40,height:30},{width:120,height:120},'bottom')).toEqual({left:72,top:56,side:'top'});
 const p = floatingPosition({left:0,top:0,width:2,height:2},{width:900,height:900},{width:100,height:100},'left'); expect(p.left).toBe(8); expect(p.top).toBe(8);
});
