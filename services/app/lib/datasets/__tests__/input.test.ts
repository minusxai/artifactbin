import {describe,expect,it} from 'vitest';
import {catalogInputShape} from '../input';

const stored=(overrides:Record<string,unknown>={})=>({
  kind:'stored',defaultSchema:'public',tables:[{schema:'public',name:'rows',rows:[{id:1}],columns:['id']}],...overrides,
});

describe('dataset structured input',()=>{
  it('uses PostgreSQL identifier byte and NUL limits throughout the catalog',()=>{
    const sixtyThreeBytes='é'.repeat(31)+'a';
    expect(catalogInputShape.safeParse(stored({defaultSchema:sixtyThreeBytes,tables:[{schema:sixtyThreeBytes,name:sixtyThreeBytes,rows:[],columns:[sixtyThreeBytes]}]})).success).toBe(true);
    for(const invalid of ['a\0b','é'.repeat(32)]){
      expect(catalogInputShape.safeParse(stored({defaultSchema:invalid})).success).toBe(false);
      expect(catalogInputShape.safeParse(stored({tables:[{schema:'public',name:invalid,rows:[],columns:['id']}]})).success).toBe(false);
      expect(catalogInputShape.safeParse(stored({tables:[{schema:'public',name:'rows',rows:[],columns:[invalid]}]})).success).toBe(false);
      expect(catalogInputShape.safeParse(stored({notebook:{cells:[{id:invalid,name:invalid,sql:'SELECT 1'}]}})).success).toBe(false);
    }
  });

  it('rejects obsolete connection ids and tables with multiple source kinds',()=>{
    expect(catalogInputShape.safeParse({...stored(),connectionId:'old-connection'}).success).toBe(false);
    expect(catalogInputShape.safeParse(stored({tables:[{schema:'public',name:'rows',rows:[],sql:'SELECT 1',columns:['id']}]})).success).toBe(false);
    expect(catalogInputShape.safeParse(stored({tables:[{schema:'public',name:'rows',source:{schema:'public',table:'raw'},modelCellId:'cell',columns:['id']}]})).success).toBe(false);
  });
});
