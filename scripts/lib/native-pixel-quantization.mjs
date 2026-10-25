/** Conservative, opt-in RGBA8 classification; never changes images or proves semantic equivalence. */
/** @type {Readonly<import('./native-pixel-quantization-contract').NativePixelQuantizationPolicy>} */
export const PIXEL_QUANTIZATION_POLICY=Object.freeze({id:'rgba8-local-quantization-v1',maxChangedPixels:16,maxChannelDelta:1,maxChangedFraction:0.00001,alphaChangesAllowed:false,explicitReviewRequired:true});
/** @returns {import('./native-pixel-quantization-contract').NativePixelDifference} */
export function pixelDifference(left,right,width,height){
 if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<1||height<1||left.length!==width*height*4||right.length!==left.length)throw Error('pixel-difference-input');
 let changedPixels=0,maxChannelDelta=0,changedAlphaPixels=0,minX=width,minY=height,maxX=-1,maxY=-1;
 for(let i=0;i<left.length;i+=4){let changed=false;for(let channel=0;channel<4;channel++){const delta=Math.abs(left[i+channel]-right[i+channel]);if(delta){changed=true;maxChannelDelta=Math.max(maxChannelDelta,delta);if(channel===3)changedAlphaPixels++;}}if(changed){changedPixels++;const x=i/4%width,y=Math.floor(i/4/width);minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}
 return {width,height,totalPixels:width*height,changedPixels,maxChannelDelta,changedAlphaPixels,bounds:changedPixels?{left:minX,top:minY,right:maxX,bottom:maxY}:null};
}
/** Raw evidence is computed from hash-checked PNG bytes, never a caller-supplied tolerance. */
export function allowsPixelQuantization(result){
 const pixels=result.pixelDifference,policy=PIXEL_QUANTIZATION_POLICY;
 return result.sizeEqual===true&&pixels&&Number.isSafeInteger(pixels.width)&&pixels.width>0&&Number.isSafeInteger(pixels.height)&&pixels.height>0&&Number.isSafeInteger(pixels.totalPixels)&&pixels.totalPixels===pixels.width*pixels.height&&Number.isSafeInteger(pixels.changedPixels)&&pixels.changedPixels===result.changedPixels&&pixels.changedPixels>0&&pixels.changedPixels<=policy.maxChangedPixels&&pixels.changedPixels/pixels.totalPixels<=policy.maxChangedFraction&&pixels.maxChannelDelta===policy.maxChannelDelta&&pixels.changedAlphaPixels===0;
}
