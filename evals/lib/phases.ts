/** Progress is emitted synchronously so a killed eval still identifies its last phase. */
export function phaseLogger(emit:(line:string)=>void,now:()=>number=()=>performance.now()):(phase:string)=>void {
 const started=now();
 let previous=started;
 return phase=>{
  const at=now();
  emit(`${phase} elapsed=${Math.round(at-started)}ms previous=${Math.round(at-previous)}ms`);
  previous=at;
 };
}
