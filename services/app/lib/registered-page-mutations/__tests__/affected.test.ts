import {it,expect} from 'vitest';
import {runMutation,isQueryFailure} from '@/lib/sql';
it('original mutation engine refuses zero/multiple affected rows before a registered transaction can commit',async()=>{
 const table={name:'rows',schema:'forms',rows:[{id:1},{id:2}],columns:[{name:'id',type:'number' as const}]};
 for(const sql of ['DELETE FROM forms.rows WHERE id=999','DELETE FROM forms.rows']){
  const result=await runMutation({table,sql,params:{},expectedAffected:1});expect(isQueryFailure(result)).toBe(true);expect(table.rows).toEqual([{id:1},{id:2}]);
 }
 const applied=await runMutation({table,sql:'DELETE FROM forms.rows WHERE id=$id',params:{id:1},expectedAffected:1});expect(isQueryFailure(applied)).toBe(false);if(!isQueryFailure(applied))expect(applied.rows).toEqual([{id:2}]);
});
