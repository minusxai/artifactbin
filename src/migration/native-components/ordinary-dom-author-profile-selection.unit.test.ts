import test from 'node:test';import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selectNativeOrdinaryDomAuthorProfiles} from './ordinary-dom-author-profile-selection.ts';
import type {NativeTypedAnalysis,RetainedJsxNode} from './analyze-contracts.ts';
const node=(script:string,options:{tag?:string;attrs?:Record<string,string>;children?:RetainedJsxNode[]}={}):RetainedJsxNode=>({type:'element',graphKey:'source-script',tag:options.tag??'script',isComponent:false,selfClosing:false,start:0,end:1,attributes:Object.entries(options.attrs??{}).map(([name,json])=>({name,value:{static:true,json},start:0,end:1})),children:options.children??[{type:'text',graphKey:'script-text',start:0,end:script.length,value:script}]});
const fixture=(script:string)=>({key:{sourceNamespace:'source',sourceId:'exact-head',version:2},nodes:[node(script)],flow:{imports:[],queries:[],mutations:[],values:[]},documentSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),analysisSha256:'c'.repeat(64),compilerSourceSha256:'d'.repeat(64),sourceSpans:[]} as NativeTypedAnalysis);
const hash=(script:string)=>createHash('sha256').update(script).digest('hex');

test('selects unbundled standard DOM code and binds exact source head, node and body hash',()=>{
 const script='document.addEventListener("DOMContentLoaded",()=>{const button=document.querySelector("#go");button?.addEventListener("click",()=>{document.body.classList.toggle("ready");});});';
 const input=fixture(script),[selected]=selectNativeOrdinaryDomAuthorProfiles(input);
 assert.deepEqual(selected,{key:input.key,sourceNode:'source-script',profile:'ordinary-dom-script',filter:'search',scriptSha256:hash(script)});
});

test('allows ordinary browser lifecycle and DOM APIs while preserving source unchanged',()=>{
 const script='const observer=new ResizeObserver(entries=>{for(const entry of entries)entry.target.dataset.width=String(entry.contentRect.width);});observer.observe(document.body);window.matchMedia("(max-width: 600px)").addEventListener("change",()=>{});';
 assert.equal(selectNativeOrdinaryDomAuthorProfiles(fixture(script)).length,1);
});

test('rejects authored module imports, unbound host globals and custom host properties',()=>{
 for(const script of [
  'import {query} from "page"; query("$rows");',
  'mx.params("search");',
  'window.__inl.setState({ready:true});',
  'globalThis.mx.params("search");',
 ])assert.deepEqual(selectNativeOrdinaryDomAuthorProfiles(fixture(script)),[]);
});

test('rejects external network, XR, clipboard, WebGL and dynamic code capabilities',()=>{
 for(const script of [
  'fetch("/private-data");',
  'navigator.xr.requestSession("immersive-vr");',
  'navigator.clipboard.readText();',
  'window.localStorage.setItem("mode","private");',
  'document.cookie="mode=private";',
  'canvas.getContext("webgl2");',
  'new Function("return document.body");',
 ])assert.deepEqual(selectNativeOrdinaryDomAuthorProfiles(fixture(script)),[]);
});

test('requires a plain script node with a fully retained static body',()=>{
 const attributed=fixture('document.body.textContent="ok";');attributed.nodes=[node('document.body.textContent="ok";',{attrs:{type:'module'}})];
 const wrongTag=fixture('document.body.textContent="ok";');wrongTag.nodes=[node('document.body.textContent="ok";',{tag:'style'})];
 const dynamic=fixture('');dynamic.nodes=[node('',{children:[{type:'expression',graphKey:'script-body',start:0,end:1,source:'value',value:{static:false,exprType:'string',source:'value'}}]})];
 assert.deepEqual(selectNativeOrdinaryDomAuthorProfiles(attributed),[]);assert.deepEqual(selectNativeOrdinaryDomAuthorProfiles(wrongTag),[]);assert.deepEqual(selectNativeOrdinaryDomAuthorProfiles(dynamic),[]);
});

test('rejects exported declarations and top-level this, which change meaning once the classic script runs as module code',()=>{
 for(const script of ['export default async function(input){return input;}','export function ready(){}','this.ready=true;','const self=(()=>this)();'])assert.deepEqual(selectNativeOrdinaryDomAuthorProfiles(fixture(script)),[]);
 assert.equal(selectNativeOrdinaryDomAuthorProfiles(fixture('function Widget(){this.ready=true;}class Box{constructor(){this.size=1;}}new Widget();new Box();')).length,1);
});
