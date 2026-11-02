import {it,expect} from 'vitest';
import {pixelDifference} from '../lib/pixel-difference.mjs';
it('counts changed pixels once across channels and preserves their exact bounds and alpha evidence',()=>{
 const left=Buffer.alloc(3*2*4),right=Buffer.from(left);
 right[4]=2;right[5]=3;right[23]=1;
 expect(pixelDifference(left,right,3,2)).toEqual({width:3,height:2,totalPixels:6,changedPixels:2,maxChannelDelta:3,changedAlphaPixels:1,bounds:{left:1,top:0,right:2,bottom:1}});
 expect(pixelDifference(left,left,3,2)).toMatchObject({changedPixels:0,bounds:null,changedAlphaPixels:0});
});
it('refuses malformed image dimensions and incomplete RGBA buffers',()=>{
 for(const [width,height,left,right] of [[0,1,[],[]],[1.5,1,[],[]],[1,1,[0],[0]],[1,1,[0,0,0,0],[]]])expect(()=>pixelDifference(left,right,width,height)).toThrow('pixel-difference-input');
});
