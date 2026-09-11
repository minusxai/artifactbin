import {expect,it} from 'vitest';
import {buildQuickSheet,QUICK_SHEET_MAX_BYTES} from '@/lib/skills';
it('teaches reuse before new publication and preserves identity during recovery',()=>{
 const sheet=buildQuickSheet('https://example.test');
 expect(sheet.indexOf('For a supplied artifact')).toBeLessThan(sheet.indexOf('For a new artifact'));
 expect(sheet).toContain('Preserve its identity');expect(sheet).toContain('retry push');
 expect(sheet).toContain('references/markup.md');expect(sheet).toContain('references/design.md');
 expect(Buffer.byteLength(sheet)).toBeLessThanOrEqual(QUICK_SHEET_MAX_BYTES);
});
