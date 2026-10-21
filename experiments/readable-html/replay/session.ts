import type { Json, LiveMessage, ReplaySession } from './contracts.ts';
export function createSession(initial: Json, sources: ReadonlyMap<string,string>, assemble: (source:string)=>string, send:(message:LiveMessage)=>void): ReplaySession {
  let own=structuredClone(initial), epoch=0, mode:'live'|'history'='live';
  return {
    get epoch(){return epoch}, get mode(){return mode}, get ownState(){return structuredClone(own)},
    enter(context){
      const source=sources.get(context.sourceRevision);
      if(source===undefined)throw Error(`Missing historical source: ${context.sourceRevision}`);
      const html=assemble(context.renderedHtml ?? source);
      const snapshot=structuredClone(context.snapshot);
      mode='history';epoch++;
      return {html,revision:context.sourceRevision,mode:'static',fidelity:context.renderedHtml===undefined?'source-only':'captured-dom',snapshot};
    },
    publish(message){
      if(mode!=='live'||message.epoch!==epoch)return false;
      const copy=structuredClone(message);
      if(copy.kind==='state')own=structuredClone(copy.value);
      send(copy);return true;
    },
    leave(){mode='live';epoch++;return structuredClone(own)}
  };
}
