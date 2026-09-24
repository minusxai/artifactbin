import {Children,type ComponentProps} from 'react';
import {flexRatios} from '@/lib/story-ui/flex-layout';
/** A flow container: height is a minimum; parent-owned ratios distribute available space. */
type FlexProps=ComponentProps<'div'>&{direction?:unknown;sizes?:unknown;height?:unknown;width?:unknown;float?:unknown};
export function Flex({children,direction='row',sizes,height,width,float,style,...props}:FlexProps){
 const items=Children.toArray(children).filter(child=>typeof child!=='string'||child.trim());const ratios=flexRatios(sizes,items.length);
 return <div {...props} style={{...style,display:'flex',flexDirection:direction==='column'?'column':'row',gap:16,minHeight:typeof height==='number'?height:undefined,width:typeof width==='number'?width:undefined,float:float==='left'||float==='right'?float:undefined}}>{items.map((child,i)=><div key={i} style={{flex:`${ratios[i]} 1 0`,minWidth:0}}>{child}</div>)}</div>;
}
