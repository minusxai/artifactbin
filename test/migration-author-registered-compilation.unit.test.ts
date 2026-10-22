// @requires archived-compiler
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileArchivedAuthor} from '../src/migration/conversion/compiled/local.ts';
const legacyRoot=process.env.PAGEGI_ARCHIVED_COMPILER_ROOT;
test('whole authored compilation binds only registered mutation names to the archived page module',{skip:!legacyRoot},async()=>{
 const input={source:'<Helmet><Import name="items" src="ref:Abcd12"/><Query name="rows">{`select title from items.rows`}</Query><Mutation name="save">{`insert into items.rows(title) values($title)`}</Mutation><script type="module">{`import {mutation} from "page";export function Editor(){const save=mutation("$save");return <button onClick={()=>save({title:"one"})}>Save</button>}`}</script></Helmet><Editor id="editor"/>',coreUrl:'/af/v1/core.js',datasetBindings:[{name:'items',legacyRef:'ref:Abcd12',backendNamespace:'data',backendHref:'/af/v1/ids/Bac123',mode:'live' as const,version:1,tables:[{schema:'main',table:'rows',columns:[{name:'title',type:'string'}]}]}],datasetMutations:[{name:'save',backendNamespace:'data',recoveryScope:'a'.repeat(64),paramTypes:{title:'string' as const}}]};
 const compiled=await compileArchivedAuthor(input,{legacyRoot:legacyRoot!});
 assert.equal(compiled.classification,'functional',JSON.stringify(compiled.issues));
 const denied=await compileArchivedAuthor({...input,datasetMutations:[]},{legacyRoot:legacyRoot!});assert.equal(denied.classification,'manual-blocked');
});
