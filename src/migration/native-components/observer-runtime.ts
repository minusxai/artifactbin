/** Read-only compatibility for the admitted source's page resources and two effects. */
export const NATIVE_OBSERVER_RUNTIME=String.raw`function installObserver(observe,plan,report){
 let active=true,snapshot={values:{},queries:{}},stop=()=>{};
 const effects=new Set(),listeners=new Set();
 const dispose=()=>{if(!active)return;active=false;stop();effects.clear();for(const remove of listeners)remove();listeners.clear();snapshot={values:{},queries:{}};};
 const run=effect=>{if(!active)return;try{effect();}catch{report('Page observer failed');dispose();}};
 const selected=(name,names)=>{if(typeof name!=='string'||name[0]!=='$'||!names.includes(name.slice(1)))throw Error('Unadmitted observer binding');return name.slice(1);};
 const api={
  signal:name=>{const key=selected(name,plan.values);return [()=>active?snapshot.values[key]??null:null];},
  query:name=>{const key=selected(name,plan.queries),read=()=>active?(snapshot.queries[key]?.rows??[]).map(row=>({...row})):[];read.loading=()=>active?!!snapshot.queries[key]?.loading:false;read.error=()=>active?snapshot.queries[key]?.error??null:null;return read;},
  createEffect:effect=>{if(typeof effect!=='function')throw Error('Invalid observer effect');if(!active)return;effects.add(effect);run(effect);},
  listen:(host,event,handler)=>{if(!active)return;if(event!=='click'||typeof handler!=='function'||!host?.addEventListener)throw Error('Invalid observer listener');const listener=()=>run(handler);host.addEventListener(event,listener);listeners.add(()=>host.removeEventListener(event,listener));},
  dispose
 };
 stop=observe(next=>{if(!active)return;if(!next.active){dispose();return;}snapshot=next;for(const effect of [...effects])run(effect);});
 if(!active)stop();
 return api;
}`;
