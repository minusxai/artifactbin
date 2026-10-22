/** Narrow declarations for the installed parser's migration-only API. */
declare module 'css-tree' {
 export function parse(source:string,options?:{context?:string}):any;
 export function walk(tree:any,visitor:((this:any,node:any,item?:any,list?:any)=>void)|{visit?:string;enter(this:any,node:any,item:any,list:any):void}):void;
 export function clone<T>(tree:T):T;
 export function generate(tree:any):string;
}
