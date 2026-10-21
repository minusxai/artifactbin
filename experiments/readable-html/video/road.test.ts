import test from 'node:test';
import assert from 'node:assert/strict';
import { placeVehicle, travelProgress } from './road.ts';
import type { RoadSampler } from './contracts.ts';
const van={left:{x:-31,y:1},right:{x:22,y:1},scale:1};
const bike={left:{x:-15,y:10},right:{x:17,y:10},scale:.8};
const roads:RoadSampler[]=[{length:700,pointAt:d=>({x:d,y:d*.4})},{length:700,pointAt:d=>({x:d,y:40*Math.sin(d/90)})}];
test('both visible tire contacts lie on the road throughout the full trip',()=>{
 for(const road of roads)for(const vehicle of [van,bike])for(let frame=0;frame<96;frame++){
 const pose=placeVehicle(road,vehicle,frame/95);
 for(const [local,target] of [[vehicle.left,pose.left],[vehicle.right,pose.right]]){
 const actual=pose.project(local);assert.ok(Math.hypot(actual.x-target.x,actual.y-target.y)<.001);
 }
 assert.ok(Math.abs(Math.hypot(pose.right.x-pose.left.x,pose.right.y-pose.left.y)-(vehicle.right.x-vehicle.left.x)*vehicle.scale)<.001);
 }
});
test('motion is monotonic and never wraps or teleports at endpoints',()=>{
 for(let rider=0;rider<4;rider++){let last=-1;for(let frame=0;frame<96;frame++){const next=travelProgress(frame/95,rider);assert.ok(next>=last&&next<=1);if(last>=0)assert.ok(next-last<.02);last=next;}}
});
test('invalid inputs fail rather than drawing misleading geometry',()=>{
 assert.throws(()=>placeVehicle(roads[0],van,NaN));
 assert.throws(()=>placeVehicle(roads[0],{...van,scale:0},.5));
 assert.throws(()=>placeVehicle({length:2,pointAt:d=>({x:d,y:0})},van,.5));
});
