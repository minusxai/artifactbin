/** Video-only research. Units are metres, y is up, bus forward is local +z. */
export interface RoadPose { x:number; z:number; yaw:number; }
export interface SceneFrame { frame:number; seconds:number; phase:0|1|2; pose:RoadPose; }
export interface Composition { spec:{width:number;height:number;fps:number;frameCount:number}; ready:Promise<void>; renderFrame(frame:number):Promise<void>; }
