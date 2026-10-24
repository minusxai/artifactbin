import type {RemotePort} from './apollo/apollo-contracts';
export interface QueryReadinessOptions {
 pending:boolean;
 timeoutMs?:number;
 schedule?:(callback:()=>void,delay:number)=>unknown;
 cancel?:(handle:unknown)=>void;
}
export interface QueryReadiness {
 online():boolean;
 pending():boolean;
 wait():Promise<RemotePort['execute']|null>;
 /** True only on an actual transition to a usable transport. */
 update(online:boolean,execute?:RemotePort['execute'],pending?:boolean):boolean;
 execute:RemotePort['execute'];
 dispose():void;
}
