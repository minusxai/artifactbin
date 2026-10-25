import {admitInitialInlineScripts,INLINE_SCRIPT_POLICY} from './inline-scripts';
import {portableRenderedDigest} from './portable-source';
import { portableScript } from './portable';
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { assertStorable } from './apollo/storable';
import type { HtmlJsonObject } from '@artifactbin/contracts';
import type { HtmlAssemblyInput } from './contract';
export type { HtmlAssemblyInput, HtmlRuntimeConfig } from './contract';
export { createClient, createLocalStore, gql, assertStorable, decodeState, encodeState, readStateFragment, stateUrl } from './apollo/client';
export type { AfClient, StatePort, RemotePort } from './apollo/apollo-contracts';

/** Native HTML only: no JSX compilation, component evaluation, or author code execution. */
export function assembleHtmlPage(input: HtmlAssemblyInput): string {
  const document = parse(input.html);
  const html = document.childNodes.find((node): node is DefaultTreeAdapterMap['element'] => node.nodeName === 'html');
  const head = html?.childNodes.find((node): node is DefaultTreeAdapterMap['element'] => node.nodeName === 'head');
  if (!head) throw new Error('HTML parser did not produce a head');
  let coreId: string | undefined;
  const removeCore = (node: DefaultTreeAdapterMap['node']) => {
    if (!('childNodes' in node)) return;
    node.childNodes = node.childNodes.filter((child) => {
      if ('attrs' in child && child.nodeName === 'meta' && child.attrs.some(attr=>attr.name==='data-af'&&attr.value===INLINE_SCRIPT_POLICY)) return false;
      if ('attrs' in child && child.nodeName === 'script' && child.attrs.some((attr) => attr.name === 'data-af' && attr.value === 'core' || attr.name === 'src' && attr.value === '/af/v1/core.js')) { coreId ??= child.attrs.find((attr) => attr.name === 'data-af-id')?.value; return false; }
      removeCore(child); return true;
    });
  };
  removeCore(document);
  if(input.offline){
    // file:// has no HTTP Content-Type. Declare encoding inside the first 1024
    // bytes, before embedded code, so browser decoding preserves its CSP hashes.
    head.childNodes=head.childNodes.filter(node=>!('attrs'in node&&node.nodeName==='meta'&&node.attrs.some(attr=>attr.name==='charset'||attr.name==='http-equiv'&&attr.value.toLowerCase()==='content-type')));
    const charset=parseFragment('<meta charset="utf-8">').childNodes[0]!;
    charset.parentNode=head;head.childNodes.unshift(charset);
  }
  const savedNodeIds: string[] = [];
  const collect = (node: DefaultTreeAdapterMap['node']) => {
    if ('attrs' in node) { const id = node.attrs.find(attr=>attr.name==='data-af-id')?.value; if(id) savedNodeIds.push(id); }
    if ('childNodes' in node) for(const child of node.childNodes) collect(child);
  };
  collect(document);
  const { appOrigin, ...publicConfig } = input.config;
  if (!publicConfig.initialState) {
    const visit = (node: DefaultTreeAdapterMap['node']): HtmlJsonObject | undefined => {
      if ('attrs' in node && node.attrs.some((attr) => attr.name === 'data-af' && attr.value === 'state')) {
        try { const value: unknown = JSON.parse(node.childNodes.filter((child) => child.nodeName === '#text').map((child) => (child as DefaultTreeAdapterMap['textNode']).value).join('')); assertStorable(value); if (value && typeof value === 'object' && !Array.isArray(value)) return value; } catch { /* Invalid initial state is ignored. */ }
      }
      if ('childNodes' in node) for (const child of node.childNodes) { const state = visit(child); if (state) return state; }
      return undefined;
    };
    publicConfig.initialState = visit(document);
  }
  const config = { ...publicConfig, savedNodeIds, ...(!input.offline && appOrigin ? { appOrigin } : {}), offline: input.offline === true };
  const json = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const safeCore = input.core.replace(/<\/script/gi, '<\\/script');
  const portable=input.offline&&input.apollo?`<script type="application/json" data-af="apollo">${JSON.stringify(input.apollo).replace(/</g,'\\u003c')}</script>`:'';
  const portableReader=input.offline&&input.reader?`<script type="application/json" data-af="reader">${JSON.stringify(input.reader).replace(/</g,'\\u003c')}</script>`:'';
  const canonical=input.offline?portableScript(input.portable?{...input.portable,renderedDigest:portableRenderedDigest(serialize(document))}:{version:1,source:input.html,renderedDigest:portableRenderedDigest(serialize(document))}):'';
  const chrome=input.offline&&input.chrome?`<script type="application/json" data-af="chrome">${JSON.stringify(input.chrome).replace(/</g,'\\u003c')}</script>`:'';
  const engine=input.offline&&input.portableEngine?`<script type="application/json" data-af="portable-engine">${JSON.stringify(input.portableEngine).replace(/</g,'\\u003c')}</script>`:'';
  const boot = parseFragment(`<script type="application/json" data-af="runtime">${json}</script>${canonical}${portable}${portableReader}${chrome}${engine}<script data-af="core">${safeCore}</script>`);
  for (const node of boot.childNodes) {
    node.parentNode = head;
    if ('attrs' in node && node.attrs.some(attr=>attr.name==='data-af'&&attr.value==='core') && input.platformScriptNonce) node.attrs.push({name:'nonce',value:input.platformScriptNonce});
    if (coreId && 'attrs' in node && node.attrs.some((attr) => attr.name === 'data-af' && attr.value === 'core')) node.attrs.push({ name: 'data-af-id', value: coreId });
  }
  head.childNodes.unshift(...boot.childNodes);
  const admission=admitInitialInlineScripts(serialize(document),input.platformScriptNonce);
  const policy=parseFragment('<meta>').childNodes[0] as DefaultTreeAdapterMap['element'];
  policy.attrs=[{name:'data-af',value:INLINE_SCRIPT_POLICY},{name:'http-equiv',value:'Content-Security-Policy'},{name:'content',value:admission.policy}];
  policy.parentNode=head;head.childNodes.unshift(policy);
  if(input.offline){
    const charset=head.childNodes.find(node=>'attrs'in node&&node.nodeName==='meta'&&node.attrs.some(attr=>attr.name==='charset'))!;
    head.childNodes=head.childNodes.filter(node=>node!==charset);head.childNodes.unshift(charset);
  }
  return serialize(document);
}
/** Downloads use the same native renderer, with no platform origin or remote capability. */
export const downloadableHtml = (input: HtmlAssemblyInput): string => assembleHtmlPage({ ...input, offline: true });
