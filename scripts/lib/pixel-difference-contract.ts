/** Raw RGBA8 differences; no image normalization or altered screenshot bytes. */
export interface PixelDifference {
 width:number;height:number;totalPixels:number;changedPixels:number;
 maxChannelDelta:number;changedAlphaPixels:number;
 bounds:null|{left:number;top:number;right:number;bottom:number};
}
