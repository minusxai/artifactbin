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
