export interface CompiledLocalMutationSnapshot {values:Record<string,unknown>;tables:Record<string,unknown>;}
export interface CompiledLocalMutationPorts {
 read():CompiledLocalMutationSnapshot;
 execute(name:string,args:unknown,row:unknown,snapshot:CompiledLocalMutationSnapshot):Promise<{target:string;rows:unknown;reset?:readonly string[]}>;
 /** Atomically compare snapshot tables before committing viewer-owned rows. */
 commit(snapshot:CompiledLocalMutationSnapshot,result:{target:string;rows:unknown;reset?:readonly string[]}):void;
 invalidate():void;
 changed(pending:boolean):void;
}
