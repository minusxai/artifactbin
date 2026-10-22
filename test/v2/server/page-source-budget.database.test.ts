import test from 'node:test';
import assert from 'node:assert/strict';
import {MAX_PAGE_SOURCE,utf8ByteLength} from '../../../src/af-contracts.ts';
import {page,startServer} from '../support/server.ts';
import {compileOnlyHost} from '../support/todo.ts';
const pad=(html:string,bytes:number)=>html.replace('</body>','<!--'+'x'.repeat(bytes-utf8ByteLength(html)-7)+'--></body>');
test('large canonical HTML publishes, downloads, and saves at exact UTF8 budget; normalization and one byte excess never save',async()=>{
 const server=await startServer({backendHost:compileOnlyHost()});
 try{const token=await server.token();
  const envelope=await server.request('/api/publish',{token,body:{source:'"'.repeat(4_000_000),requestId:'escaped-envelope'}});assert.equal(envelope.status,413);assert.match(await envelope.text(),/Request too large/);
  const published=await server.request('/api/publish',{token,body:{source:page('<pre>'+'x'.repeat(4_200_000)+'</pre>'),requestId:'large-source'}});
  assert.equal(published.status,201);const created=await published.json() as {id:string;source:string};
  const download=await server.request(`/a/${created.id}?download=1`,{token});assert.equal(download.status,200);assert.match(await download.text(),/<pre data-af-id="[^"]+">x{100}/);
  let exact=pad(created.source,MAX_PAGE_SOURCE);assert.equal(utf8ByteLength(exact),MAX_PAGE_SOURCE);
  const saved=await server.request(`/api/files/${created.id}/source`,{method:'PUT',token,headers:{'If-Match':'1'},body:{source:exact}});assert.equal(saved.status,200,await saved.clone().text());const value=await saved.json() as {source:string};assert.equal(utf8ByteLength(value.source),MAX_PAGE_SOURCE);
  exact=value.source.replace('xxx','☃');assert.equal(utf8ByteLength(exact),MAX_PAGE_SOURCE);
  const unicode=await server.request(`/api/files/${created.id}/source`,{method:'PUT',token,headers:{'If-Match':'2'},body:{source:exact}});assert.equal(unicode.status,200);
  const rejected=await server.request(`/api/files/${created.id}/source`,{method:'PUT',token,headers:{'If-Match':'3'},body:{source:exact.replace('☃','☃x')}});assert.equal(rejected.status,422);assert.match(await rejected.text(),/6,000,000 UTF-8 bytes/);
  const raw=pad(page('<p>New</p>'),MAX_PAGE_SOURCE);const normalized=await server.request('/api/publish',{token,body:{source:raw,requestId:'normalization-over'}});assert.equal(normalized.status,422);
  const rows=await server.query('SELECT head FROM files WHERE id=$1',[created.id]);assert.equal(rows.rows[0]!.head,'3');
  const count=await server.query('SELECT count(*) AS count FROM sources WHERE file_id=$1',[created.id]);assert.equal(Number(count.rows[0]!.count),3);
 }finally{await server.close();}
});
