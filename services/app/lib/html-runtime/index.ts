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
      if ('attrs' in child && child.nodeName === 'script' && child.attrs.some((attr) => attr.name === 'data-af' && attr.value === 'core' || attr.name === 'src' && attr.value === '/af/v1/core.js')) { coreId ??= child.attrs.find((attr) => attr.name === 'data-af-id')?.value; return false; }
      removeCore(child); return true;
    });
  };
  removeCore(document);
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
  const boot = parseFragment(`<script type="application/json" data-af="runtime">${json}</script><script data-af="core">${safeCore}</script>`);
  for (const node of boot.childNodes) {
    node.parentNode = head;
    if (coreId && 'attrs' in node && node.attrs.some((attr) => attr.name === 'data-af' && attr.value === 'core')) node.attrs.push({ name: 'data-af-id', value: coreId });
  }
  head.childNodes.unshift(...boot.childNodes);
  return serialize(document);
}
/** Downloads use the same native renderer, with no platform origin or remote capability. */
export const downloadableHtml = (input: HtmlAssemblyInput): string => assembleHtmlPage({ ...input, offline: true });
