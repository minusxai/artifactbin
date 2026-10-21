import type {RoadPose,SceneFrame} from './contracts.ts';
export const ROAD_Y=.225, WHEEL_RADIUS=.19;
export function poseAt(t:number):RoadPose{return {x:8*Math.cos(t),z:5*Math.sin(t),yaw:Math.atan2(-8*Math.sin(t),5*Math.cos(t))};}
export function frameAt(frame:number):SceneFrame{if(!Number.isInteger(frame)||frame<0||frame>=288)throw new RangeError('Frame must be integer 0…287');return {frame,seconds:frame/24,phase:Math.min(2,Math.floor(frame/96)) as 0|1|2,pose:poseAt(.38+frame/287*Math.PI*1.65)};}
