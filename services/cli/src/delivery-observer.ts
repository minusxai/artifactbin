/** A delivery projection must retain confirmed evidence before sync clears its journal. */
import {AsyncLocalStorage} from 'node:async_hooks';
import type {TrackedFile} from './workspace';
const observers=new AsyncLocalStorage<(path:string,entry:TrackedFile,accepted:Buffer)=>Promise<void>>();
export function withDeliveryObserver<T>(observe:(path:string,entry:TrackedFile,accepted:Buffer)=>Promise<void>,run:()=>Promise<T>):Promise<T>{return observers.run(observe,run);}
export async function observeDelivery(path:string,entry:TrackedFile,accepted:Buffer):Promise<void>{await observers.getStore()?.(path,entry,accepted);}
