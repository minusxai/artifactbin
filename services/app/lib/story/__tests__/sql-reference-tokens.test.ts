import {expect,it} from 'vitest';
import {removedSqlReferenceTokens} from '../sql-reference-tokens';
it('reports unterminated strings instead of treating the remaining SQL as valid',()=>{
 for(const source of ["select 'unfinished", "select 'escaped\\", "select 'quote''"]){expect(removedSqlReferenceTokens(source).diagnostic).toBe('unterminated SQL string');}
});
it('keeps literal examples and comments separate from retired SQL reference identifiers',()=>{
 const result=removedSqlReferenceTokens(`select 'ref_abc123', $$ref_def456$$ from ref_ghi789 /* ref_jkl012 */ -- ref_mno345`);
 expect(result.diagnostic).toBeUndefined();expect(result.tokens.map(token=>token.id)).toEqual(['ghi789']);
});
