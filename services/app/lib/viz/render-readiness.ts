/** DOM-only readiness shared by overlapping Vega build, data, and resize work. */
const pending=new WeakMap<HTMLElement,number>();
export function beginChartRender(element:HTMLElement):()=>void {
  pending.set(element,(pending.get(element)??0)+1);
  element.dataset.mxChartState='pending';
  let settled=false;
  return ()=>{
    if(settled)return;settled=true;
    const remaining=(pending.get(element)??1)-1;
    if(remaining>0)pending.set(element,remaining);
    else {pending.delete(element);element.dataset.mxChartState='ready';}
  };
}
export async function trackChartRender<T>(element:HTMLElement,work:()=>Promise<T>):Promise<T> {
  const finish=beginChartRender(element);
  try{return await work();}finally{finish();}
}
