/** Serializable boundary between the thin CLI and its lazy preview/browser runtime. */
export interface LocalImageOptions {cwd:string;home:string;path:string;server:string;format:'png'|'jpg';page?:number;og?:boolean}
export type LocalImageRenderer=(options:LocalImageOptions)=>Promise<Buffer>;
