import {expect,it} from 'vitest';
import {readerPreferences} from '../preferences';
it('keeps reader choices out of app state, remembers reloads and preserves independent tab choices',()=>{
 let saved:string|null=null;const storage={getItem:()=>saved,setItem:(_key:string,value:string)=>{saved=value;}};
 const a=readerPreferences(storage),b=readerPreferences(storage);a.set('showCursors',false);b.set('shareSelection',false);
 expect(a.read().shareSelection).toBe(true);expect(b.read().showCursors).toBe(true);
 expect(readerPreferences(storage).read()).toMatchObject({showCursors:false,shareSelection:false});
 expect(readerPreferences(null).set('visible',false).visible).toBe(false);
});
