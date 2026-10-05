import {describe,expect,it} from 'vitest';
import {parseJsxOrThrow} from '@/test/helpers/jsx';
import {splitHelmet,validateHelmet} from '../document/helmet';
import {compiledDocument} from '@/lib/compiled-page/__tests__/document-helper';
import {serializeJsx} from '@/lib/jsx';
import {prepareStoryRuntime} from '../prepared/prepare-runtime.server';

const parse=(source:string)=>parseJsxOrThrow(source).nodes;
const server='export default async input => ({marker: "SERVER_PRIVATE_MARKER", input});';
const browser='export const label = "BROWSER_MARKER";';
const doc=`<Helmet><script>{${JSON.stringify(browser)}}</script><script type="server">{${JSON.stringify(server)}}</script></Helmet><p>Both contexts</p>`;
describe('artifact server script boundary',()=>{
 it('allows one independently typed server handler beside the browser module',()=>{
  const nodes=parse(doc);expect(validateHelmet(nodes)).toEqual([]);
  expect(splitHelmet(nodes).content).toMatchObject({script:browser,serverScript:server});
 });
 it('does not put server source in reader runtime data or browser module',async()=>{
  const runtime=await prepareStoryRuntime({source:doc,compiledCss:null,theme:null,colorMode:null,title:null,refData:{}});
  expect(runtime.authorScript).toContain('BROWSER_MARKER');
  expect(JSON.stringify(runtime)).not.toContain('SERVER_PRIVATE_MARKER');
  const only=await prepareStoryRuntime({source:`<Helmet><script type="server">{${JSON.stringify(server)}}</script></Helmet><p>API</p>`,compiledCss:null,theme:null,colorMode:null,title:null,refData:{}});
  expect(only.authorScript).toBeNull();expect(JSON.stringify(only)).not.toContain('SERVER_PRIVATE_MARKER');
 });
 it('keeps server source out of the actual compiled reader and preserves it through source round trips',async()=>{
  const serialized=serializeJsx(parse(doc));
  expect(validateHelmet(parse(serialized))).toEqual([]);
  expect(splitHelmet(parse(serialized)).content).toMatchObject({script:browser,serverScript:server});
  const html=await compiledDocument({source:doc,compiledCss:null,theme:null,colorMode:null,title:null,refData:{}});
  expect(html).toContain('BROWSER_MARKER');expect(html).not.toContain('SERVER_PRIVATE_MARKER');
 });
 it('rejects duplicate handlers, unsupported types and extra script attributes',()=>{
  for(const contents of [
   '<script type="server">{`export default () => 1`}</script><script type="server">{`export default () => 2`}</script>',
   '<script type="python">{`print(1)`}</script>',
   '<script type="server" src="https://evil.example/x.js">{`export default () => 1`}</script>',
  ])expect(validateHelmet(parse(`<Helmet>${contents}</Helmet>`))).not.toEqual([]);
 });
});
