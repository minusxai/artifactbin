import {test} from 'vitest';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Execute the actual diagnostic HTTP handler without launching a browser.
const source=readFileSync(new URL('../planning/srcdoc-startup-reduction.mjs',import.meta.url),'utf8');
let handler;
runInNewContext(source.slice(source.indexOf('const literal='),source.indexOf('await new Promise')),
  {URL,process:{argv:[]},createServer:fn=>{handler=fn;return {};}});
const request=query=>{
  const result={statusCode:200,body:''};
  handler({url:'/?'+query},{setHeader(){},set statusCode(value){result.statusCode=value;},end(body){result.body=body;}});
  return result;
};
test('startup diagnostic rejects invalid or unbounded size and nesting before allocation',()=>{
  for(const query of ['size=-1','size=1.5','size=NaN','size=Infinity','size=262145','depth=-1','depth=1.5','depth=NaN','depth=Infinity','depth=5']){
    assert.equal(request(query).statusCode,400,query);
  }
});
test('startup diagnostic retains its measured 25KB two-level workload',()=>{
  const result=request('size=25000&depth=2&policy=on');
  assert.equal(result.statusCode,200);
  assert.match(result.body,/author-ready/);
  assert.match(result.body,/allow-scripts/);
});
