import test from 'node:test';
import assert from 'node:assert/strict';
import {rewriteMigrationLinks} from '../src/migration/links.ts';
test('links map known legacy addresses and explicit origins while preserving unrelated text and external URLs',()=>{
 const html='<a href="https://legacy.example.test/a/oldIdentifier?q=1#x">oldIdentifier</a><a href="/@some-handle/oldIdentifier">Profile</a><a href="https://other.example.test/a/oldIdentifier">External</a><p>/a/oldIdentifier</p>';
 const result=rewriteMigrationLinks(html,{pages:{oldIdentifier:'abc123'},users:{},groups:{},tokens:{}},{legacyOrigins:['https://legacy.example.test'],targetOrigin:'https://new.example.test'});
 assert.ok(result.includes('href="https://new.example.test/a/abc123?q=1#x"'));assert.ok(result.includes('href="/@some-handle/abc123"'));assert.ok(result.includes('https://other.example.test/a/oldIdentifier'));assert.ok(result.includes('<p>/a/oldIdentifier</p>'));
});
