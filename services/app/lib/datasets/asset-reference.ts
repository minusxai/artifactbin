/** Authorized asset metadata consumed by native HTML publication. */
interface ServerRef {id:string;format:string}
export type ServerRefLoader=(id:string)=>Promise<ServerRef|null>;
