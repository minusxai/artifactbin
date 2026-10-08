import {describe,expect,it} from 'vitest';
import {catalogFromMetadata} from '../catalog-metadata';

describe('catalogFromMetadata',()=>{
  const catalog={kind:'stored',defaultSchema:'public',refreshSeconds:0,tables:[]};
  it('is the stored meta.catalog',()=>{
    expect(catalogFromMetadata({catalog})).toEqual(catalog);
  });
  it('is null for a row without one — a flat objectKey is no longer read as a table',()=>{
    expect(catalogFromMetadata({objectKey:'dataset/abc',columns:[{name:'a',type:'string'}]})).toBeNull();
    expect(catalogFromMetadata(null)).toBeNull();
    expect(catalogFromMetadata([])).toBeNull();
  });
});
