import type {RoadSampler,VehicleContacts,RoadPlacement,RoadPoint} from './contracts.ts';
const distance=(a:RoadPoint,b:RoadPoint)=>Math.hypot(a.x-b.x,a.y-b.y);
/** This adapter expects an open, non-looping road with monotonic chord distances. */
export function placeVehicle(road:RoadSampler,vehicle:VehicleContacts,progress:number):RoadPlacement{
 const width=(vehicle.right.x-vehicle.left.x)*vehicle.scale;
 if(!Number.isFinite(progress)||progress<0||progress>1||!Number.isFinite(width)||width<=0||vehicle.left.y!==vehicle.right.y||road.length<=width)throw new RangeError('Invalid road placement');
 const end=road.pointAt(road.length);let lo=0,hi=road.length;
 if(distance(road.pointAt(0),end)<width)throw new RangeError('Road too short');
 for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(distance(road.pointAt(mid),end)>width)lo=mid;else hi=mid;}
 const startDistance=lo*progress,left=road.pointAt(startDistance);lo=startDistance;hi=road.length;
 for(let i=0;i<48;i++){const mid=(lo+hi)/2;if(distance(left,road.pointAt(mid))<width)lo=mid;else hi=mid;}
 const right=road.pointAt((lo+hi)/2),angle=Math.atan2(right.y-left.y,right.x-left.x),c=Math.cos(angle)*vehicle.scale,s=Math.sin(angle)*vehicle.scale;
 const tx=left.x-c*vehicle.left.x+s*vehicle.left.y,ty=left.y-s*vehicle.left.x-c*vehicle.left.y;
 return{left,right,angle,transform:`matrix(${c} ${s} ${-s} ${c} ${tx} ${ty})`,project:p=>({x:c*p.x-s*p.y+tx,y:s*p.x+c*p.y+ty})};
}
export function travelProgress(progress:number,rider:number):number{return Math.min(1,Math.max(0,progress*.7+rider*.08));}
