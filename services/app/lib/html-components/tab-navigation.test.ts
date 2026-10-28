import {expect,it} from 'vitest';
import {tabFocusTarget} from './tab-navigation';

it('moves within enabled tabs, wraps or clamps, and honors direction',()=>{
  const base={index:0,count:3,orientation:'horizontal' as const,dir:'ltr' as const,loop:true};
  expect(tabFocusTarget({...base,key:'ArrowRight'})).toBe(1);
  expect(tabFocusTarget({...base,key:'ArrowLeft'})).toBe(2);
  expect(tabFocusTarget({...base,key:'ArrowLeft',loop:false})).toBe(0);
  expect(tabFocusTarget({...base,index:2,key:'ArrowRight',loop:false})).toBe(2);
  expect(tabFocusTarget({...base,key:'ArrowRight',dir:'rtl'})).toBe(2);
  expect(tabFocusTarget({...base,key:'ArrowLeft',dir:'rtl'})).toBe(1);
});
it('keeps orthogonal arrows and unrelated keys available to the page',()=>{
  const base={index:1,count:3,orientation:'vertical' as const,dir:'rtl' as const,loop:true};
  expect(tabFocusTarget({...base,key:'ArrowDown'})).toBe(2);
  expect(tabFocusTarget({...base,key:'ArrowUp'})).toBe(0);
  for(const key of ['ArrowLeft','ArrowRight','Tab','Enter','a']) expect(tabFocusTarget({...base,key})).toBeNull();
});
it('handles first/last selection, no enabled targets and single target',()=>{
  const base={index:1,count:3,orientation:'horizontal' as const,dir:'ltr' as const,loop:true};
  expect(tabFocusTarget({...base,key:'Home'})).toBe(0);
  expect(tabFocusTarget({...base,key:'End'})).toBe(2);
  expect(tabFocusTarget({...base,key:'Home',count:0})).toBeNull();
  expect(tabFocusTarget({...base,key:'ArrowRight',count:1,index:0})).toBe(0);
});
