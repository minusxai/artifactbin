/** Geometry shared by the rendered Flex and its editor handles. */
export function flexRatios(sizes:unknown,count:number):number[]{
 const values=Array.isArray(sizes)?sizes:[];
 return Array.from({length:count},(_,i)=>typeof values[i]==='number'&&Number.isFinite(values[i])&&values[i]>0?values[i]:1);
}
export function resizeFlexRatios(sizes:number[],index:number,delta:number,extent:number):number[]{
 const next=sizes.slice();if(index<0||index>=sizes.length-1||!Number.isFinite(delta)||!Number.isFinite(extent)||extent<=0)return next;
 const pair=sizes[index]+sizes[index+1],minimum=Math.min(.1,pair/10),total=sizes.reduce((a,b)=>a+b,0);
 next[index]=Math.max(minimum,Math.min(pair-minimum,sizes[index]+delta/extent*total));next[index+1]=pair-next[index];return next;
}
/** The resize target is the actual midpoint of a gutter, never a parent toolbar icon. */
export function dividerPosition(before:{start:number;size:number},after:{start:number;size:number}):number{return (before.start+before.size+after.start)/2;}
export function widthPercentage(width:number,available:number):number{return available>0?Math.round(width/available*1000)/10:0;}
export function setFlexChildShare(sizes:number[],index:number,percentage:number):number[]{
 if(sizes.length<2||index<0||index>=sizes.length||!Number.isFinite(percentage))return sizes.slice();
 const total=sizes.reduce((a,b)=>a+b,0),neighbor=index===sizes.length-1?index-1:index;
 const delta=percentage/100*total-sizes[index];
 return resizeFlexRatios(sizes,neighbor,index===neighbor?delta:-delta,total);
}
