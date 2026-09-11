import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {parseDocument} from 'yaml';
const built=await build({stdin:{contents:`export {parseJsx} from './services/app/lib/jsx/parse'; export {serializeJsx} from './services/app/lib/jsx/serialize';`,resolveDir:process.cwd()},bundle:true,platform:'browser',format:'esm',write:false});
const {parseJsx,serializeJsx}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
// Slice the fence before parsing. Keep exact fence bytes through body-only formatting.
function split(text) { const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text); if(!match)return {header:'',fields:{},source:text}; const doc=parseDocument(match[1],{uniqueKeys:true}); if(doc.errors.length)throw Error('invalid metadata'); return {header:match[0],fields:doc.toJSON(),source:text.slice(match[0].length)}; }
test('fence retains comments, YAML quoting and CRLF while body formatting preserves ids/entities',()=>{
 const header='---\r\nid: abc123 # stable identity\r\ntitle: "A: B"\r\n---\r\n';
 const {fields,source,...rest}=split(header+'<p id="Ab12">A &amp; B</p>'); assert.equal(fields.title,'A: B');
 const p=parseJsx(source); assert.equal(p.ok,true); const canonical=serializeJsx(p.nodes);
 const roundtrip=split(rest.header+canonical); assert.equal(roundtrip.header,header); assert.match(canonical,/id="Ab12"/);assert.match(canonical,/A &amp; B/);
 assert.equal(serializeJsx(parseJsx(canonical).nodes),canonical);
});
test('duplicate metadata is refused and body delimiters remain body content',()=>{
 assert.throws(()=>split('---\nid: a\nid: b\n---\n<p />'),/metadata/);
 const input='---\nid: a\n---\n<pre>{`---\\ncontent`}</pre>'; assert.equal(split(input).source,'<pre>{`---\\ncontent`}</pre>');
});
