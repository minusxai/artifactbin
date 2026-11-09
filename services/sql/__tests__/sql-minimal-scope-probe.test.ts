import { expect, it } from 'vitest';
import { loadSqlite, type Relation } from '@artifactbin/sql/core';
const engine = await loadSqlite();
const schema: Relation[] = ['tasks', 'id', 'odd"name'].map(table => ({ schema: 'main', table, columns: [{name:'id',type:'number'}] }));
schema.push({ schema:'restricted',table:'rows',columns:[{name:'id',type:'number'}] });
const selected = (sql:string) => [...new Set(engine.analyze(sql,schema).reads.map(r=>r.schema==='main'?r.table:r.schema))].sort();
it.each([
 ['SELECT id FROM tasks',['tasks']],
 ['SELECT id FROM tasks AS id',['tasks']],
 ["SELECT 'id' FROM tasks -- id",['tasks']],
 ['WITH id AS (SELECT id FROM tasks) SELECT * FROM id',['tasks']],
 ['WITH id AS (SELECT 1) SELECT * FROM main.id',['id']],
 ['SELECT * FROM "ID"',['id']],
 ['SELECT * FROM [id]',['id']],
 ['SELECT * FROM `id`',['id']],
 ['SELECT * FROM "odd""name"',['odd"name']],
 ['SELECT * FROM "restricted"."rows"',['restricted']],
 ['SELECT count(*) FROM id',['id']],
 ['SELECT * FROM tasks WHERE EXISTS (SELECT 1 FROM id)',['id','tasks']],
] as const)('uses SQLite relations: %s',(sql,want)=>expect(selected(sql)).toEqual(want));
it('does not authorize writes merely because analyze accepts their shape',()=>{
 expect(engine.analyze('DELETE FROM id',schema).kind).toBe('delete');
 expect(()=>selected('SELECT * FROM tasks; SELECT * FROM id')).toThrow();
});
