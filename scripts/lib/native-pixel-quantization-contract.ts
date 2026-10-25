/** Raw RGBA8 differences; no image normalization or altered screenshot bytes. */
export interface NativePixelDifference {
 width:number;height:number;totalPixels:number;changedPixels:number;
 maxChannelDelta:number;changedAlphaPixels:number;
 bounds:null|{left:number;top:number;right:number;bottom:number};
}
/** Fixed post-capture policy, separately reported from strict zero-pixel equality. */
export interface NativePixelQuantizationPolicy {
 id:'rgba8-local-quantization-v1';maxChangedPixels:16;maxChannelDelta:1;
 maxChangedFraction:0.00001;
 alphaChangesAllowed:false;explicitReviewRequired:true;
}
export interface NativePixelComparisonClassification {
 strict:{passed:boolean;issues:string[]};
 quantization:{policy:NativePixelQuantizationPolicy;acceptedStateKeys:string[]};
 issues:string[];
}
