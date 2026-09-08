import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {sameReaderPosition} from '../lib/gate-reader-position.mjs';
it('rejects a visible paragraph jump even when scrollY is unchanged',()=>{
 const before={id:'f7',top:140,scrollY:900};
 expect(sameReaderPosition(before,{...before,top:244})).toBe(false);
 expect(sameReaderPosition(before,{...before,scrollY:1004})).toBe(true);
 expect(sameReaderPosition(before,{...before,id:'f8'})).toBe(false);
 expect(sameReaderPosition(before,{...before,top:144})).toBe(true);
 expect(sameReaderPosition(before,{...before,top:NaN})).toBe(false);
});
it('records the same visible paragraph across entering, readiness, typing and exit',()=>{
 const gate=readFileSync(new URL('../gate-inplace-edit.mjs',import.meta.url),'utf8');
 for(const stage of ['before-enter','entered','editor-ready','typed','before-exit','exited'])expect(gate).toContain(`'${stage}'`);
 expect(gate).toContain('sameReaderPosition(');
 expect(gate).not.toContain('Math.abs(await frame().evaluate(() => window.scrollY)');
});
