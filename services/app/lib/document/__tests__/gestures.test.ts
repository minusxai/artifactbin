import {expect,it} from 'vitest';
import {insertionLine} from '../gestures';
it('places a horizontal marker across the destination block before or after it',()=>{
 const box={left:80,right:420,top:100,bottom:160};
 expect(insertionLine(box,false)).toEqual({left:80,top:100,width:340});
 expect(insertionLine(box,true)).toEqual({left:80,top:160,width:340});
});
it('keeps markers inside a narrow nested column',()=>{
 expect(insertionLine({left:500,right:620,top:20,bottom:80},false)).toEqual({left:500,top:20,width:120});
});
