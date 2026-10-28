import {readerDefaults,type ReaderPreferences} from './contract';
const key='artifactbin-reader-presence';
/** Platform-origin private reader choices, never part of page state or downloaded HTML. */
export function readerPreferences(storage: Pick<Storage,'getItem'|'setItem'> | null) {
 const decode=(raw:string|null):ReaderPreferences=>{let parsed:Record<string,unknown>={};try{parsed=JSON.parse(raw??'{}')??{};}catch{}const result={...readerDefaults};for(const name of Object.keys(result) as (keyof ReaderPreferences)[])if(typeof parsed[name]==='boolean')result[name]=parsed[name] as boolean;return result;};
 let current=decode((()=>{try{return storage?.getItem(key)??null;}catch{return null;}})());
 return {read:()=>({...current}),set:(name:keyof ReaderPreferences,value:boolean)=>{current={...current,[name]:value};try{storage?.setItem(key,JSON.stringify({...decode(storage.getItem(key)),[name]:value}));}catch{}return {...current};}};
}
