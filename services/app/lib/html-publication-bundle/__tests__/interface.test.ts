/** The bundle's read-only doors: the inspection an agent previews, which mapped files changed, and the authoring source. */
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {changedBundlePaths,inspectPublicationBundle,planPublicationBundle} from '../index';
import {authoringHtml} from '../plan';

const file=(path:string,text:string,contentType='text/plain')=>({path,contentType,base64:Buffer.from(text).toString('base64')});
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');

describe('inspectPublicationBundle',()=>{
 it('reports the entry, backends, dependency sizes, reused paths and the limits without writing anything',()=>{
  const html='<link rel="af-backend" data-af-name="api" href="./api.graphql"><link rel="stylesheet" href="./main.css"><img src="./logo.svg"><img src="./kept.png">';
  const inspected=inspectPublicationBundle(html,{entryPath:'index.html',files:[file('api.graphql','type Query{ok:Boolean}'),file('main.css','body{background:url(./logo.svg)}','text/css'),file('logo.svg','<svg>☕</svg>','image/svg+xml')],mappings:{'kept.png':{kind:'asset',id:'KEPT12',revision:'1'}}});
  expect(inspected).toEqual({
   entryPath:'index.html',
   backends:[{name:'api',path:'api.graphql',bytes:Buffer.byteLength('type Query{ok:Boolean}')}],
   dependencies:[
    {path:'logo.svg',kind:'asset',contentType:'image/svg+xml',bytes:Buffer.byteLength('<svg>☕</svg>'),dependencies:[]},
    {path:'main.css',kind:'asset',contentType:'text/css',bytes:Buffer.byteLength('body{background:url(./logo.svg)}'),dependencies:['logo.svg']},
   ],
   reusedPaths:['kept.png'],
   limits:{files:99,fileBytes:4_000_000,totalBytes:16_000_000},
  });
 });
 it('inspects an empty bundle and refuses what publication would refuse',()=>{
  expect(inspectPublicationBundle('<p>no files</p>',{entryPath:'index.html',files:[]})).toMatchObject({dependencies:[],backends:[],reusedPaths:[]});
  expect(()=>inspectPublicationBundle('<img src="./gone.png">',{entryPath:'index.html',files:[]})).toThrow('Unresolved local dependencies: gone.png');
  expect(()=>inspectPublicationBundle('',{entryPath:'index.html',files:Array.from({length:100},(_,i)=>file(`f${i}.txt`,'x'))})).toThrow('Invalid publication bundle');
  expect(()=>inspectPublicationBundle('',{entryPath:'index.html',files:[],mappings:{'./a.png':{kind:'asset',id:'A12345',revision:'1'}}})).toThrow('Noncanonical mapping path');
 });
});

describe('changedBundlePaths',()=>{
 const html='<link rel="stylesheet" href="./main.css"><img src="./other.svg">';
 const files=[file('main.css','body{background:url(./logo.svg)}','text/css'),file('logo.svg','<svg>new</svg>','image/svg+xml'),file('other.svg','<svg/>','image/svg+xml')];
 const plan=planPublicationBundle(html,{entryPath:'index.html',files});
 it('marks a mapped file whose bytes moved, and the stylesheet that contains it even when its own bytes did not',()=>{
  const mappings={
   'logo.svg':{kind:'asset' as const,id:'LOGO12',revision:'1',sha256:sha('<svg>old</svg>')},
   'main.css':{kind:'asset' as const,id:'MAIN12',revision:'1',sha256:sha('body{background:url(./logo.svg)}')},
   'other.svg':{kind:'asset' as const,id:'OTHR12',revision:'1',sha256:sha('<svg/>')},
  };
  expect([...changedBundlePaths(plan,mappings)].sort()).toEqual(['logo.svg','main.css']);
 });
 it('reports nothing for unmapped files, unchanged bytes or no mappings',()=>{
  expect(changedBundlePaths(plan).size).toBe(0);
  expect(changedBundlePaths(plan,{'logo.svg':{kind:'asset',id:'LOGO12',revision:'1',sha256:sha('<svg>new</svg>')}}).size).toBe(0);
 });
});

describe('authoringHtml',()=>{
 const receipts=[{path:'img/logo.svg',kind:'asset' as const,id:'IMG123',revision:'2'},{path:'data/tasks.csv',kind:'dataset' as const,id:'DATA12',revision:'1'}];
 it('turns admitted asset addresses and dataset refs back into paths relative to the entry, keeping presentation query and hash',()=>{
  const html='<img data-af-id="a" src="/a/PAGE12/assets?dependency=IMG123&amp;revision=2&amp;version=5&amp;w=2&amp;h=3#frag"><img src="https://app.test/a/PAGE12/assets?dependency=IMG123&revision=2"><link rel="af-dataset" data-af-name="tasks" href="ref:DATA12"><p>名前</p>';
  expect(authoringHtml(html,{server:'https://app.test/api',pageId:'PAGE12',entryPath:'site/index.html',receipts})).toBe('<img data-af-id="a" src="../img/logo.svg?w=2&amp;h=3#frag"><img src="../img/logo.svg"><link rel="af-dataset" data-af-name="tasks" href="../data/tasks.csv"><p>名前</p>');
  expect(authoringHtml('<img src="/a/PAGE12/assets?dependency=IMG123&revision=2">',{server:'https://app.test',pageId:'PAGE12',entryPath:'index.html',receipts})).toBe('<img src="./img/logo.svg">');
 });
 it('leaves other origins, other pages, other revisions and unknown ids exactly as written',()=>{
  const html='<img src="https://elsewhere.test/a/PAGE12/assets?dependency=IMG123&revision=2"><img src="/a/OTHER1/assets?dependency=IMG123&revision=2"><img src="/a/PAGE12/assets?dependency=IMG123&revision=1"><img src="/a/PAGE12/assets?dependency=NOPE12&revision=2"><link rel="af-dataset" href="ref:NOPE12">';
  expect(authoringHtml(html,{server:'https://app.test',pageId:'PAGE12',entryPath:'index.html',receipts})).toBe(html);
  expect(authoringHtml('',{server:'https://app.test',pageId:'PAGE12',entryPath:'index.html',receipts})).toBe('');
 });
 it('refuses a receipt path that escapes the project',()=>{
  expect(()=>authoringHtml('<img src="ref:EVIL12">',{server:'https://app.test',pageId:'PAGE12',entryPath:'index.html',receipts:[{path:'../secret.png',kind:'asset',id:'EVIL12',revision:'1'}]})).toThrow('Invalid bundle path');
  expect(()=>authoringHtml('<link rel="af-dataset" href="ref:EVIL12">',{server:'https://app.test',pageId:'PAGE12',entryPath:'index.html',receipts:[{path:'../secret.csv',kind:'dataset',id:'EVIL12',revision:'1'}]})).toThrow('Invalid bundle path');
 });
});
