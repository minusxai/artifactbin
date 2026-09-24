import {expect,it} from 'vitest';
import {flexRatios,resizeFlexRatios,dividerPosition,widthPercentage,setFlexChildShare} from '@/lib/story-ui/flex-layout';
import {STORY_UI_COMPONENT_NAME_LIST} from '@/lib/story-ui/component-names';
it('shares one registered Flex vocabulary and proportional sizing rule',()=>{
 expect(STORY_UI_COMPONENT_NAME_LIST).toContain('Flex');expect(flexRatios([2,1],2)).toEqual([2,1]);expect(flexRatios([0,NaN],3)).toEqual([1,1,1]);
});
it('resizes only an adjacent pair and conserves their total weight',()=>{
 expect(resizeFlexRatios([2,1,1],0,100,400)[0]).toBeCloseTo(2.9);expect(resizeFlexRatios([2,1,1],0,100,400)[1]).toBeCloseTo(.1);
 expect(resizeFlexRatios([2,1,1],1,-100,400)).toEqual([2,.1,1.9]);
 expect(resizeFlexRatios([2,1],0,100,0)).toEqual([2,1]);
 expect(resizeFlexRatios([2,1],9,100,400)).toEqual([2,1]);
});
it('places the divider in the gap between adjacent children',()=>{
 expect(dividerPosition({start:20,size:260},{start:296,size:124})).toBe(288);
 expect(widthPercentage(300,800)).toBe(37.5);expect(widthPercentage(100,0)).toBe(0);
});
it('changes one child share against its neighbor while preserving the total',()=>{
 expect(setFlexChildShare([2,1],0,50)).toEqual([1.5,1.5]);
 expect(setFlexChildShare([1,1,1],1,50)).toEqual([1,.5+1,.5]);
 expect(setFlexChildShare([1,1],1,25)).toEqual([1.5,.5]);
});
