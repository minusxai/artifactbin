/** Test-only page-start instrumentation; serializable for addInitScript. */
export function installLayoutShiftProbe() {
  const rect=r=>r?{x:r.x,y:r.y,width:r.width,height:r.height}:null;
  const probe={total:0,entries:[],marks:[],phase:'initial-load',mark(phase){
    this.phase=phase;this.marks.push({phase,time:performance.now()});
  }};
  probe.mark('initial-load');
  globalThis.__mxLayoutShiftProbe=probe;
  new PerformanceObserver(list=>{
    for(const entry of list.getEntries()){
      if(!entry.hadRecentInput)probe.total+=entry.value;
      probe.entries.push({time:entry.startTime,value:entry.value,hadRecentInput:entry.hadRecentInput,
        phase:probe.marks.findLast(mark=>mark.time<=entry.startTime)?.phase??'initial-load',sources:(entry.sources??[]).map(source=>({
          tag:source.node?.tagName??null,id:source.node?.id??null,
          class:source.node?.getAttribute?.('class')??null,
          previous:rect(source.previousRect),current:rect(source.currentRect),
        })),
      });
    }
  }).observe({type:'layout-shift',buffered:true});
}
