import type {JsxElement} from '@/lib/jsx';

export interface ManagedIframeScript {type: 'classic' | 'module'; source?: string; src?: string}
export interface ManagedIframeContent {html: string; scripts: ManagedIframeScript[]}
/** Compile inert author content, never parent DOM. Throws on invalid inner grammar. */
export function compileManagedIframe(node: JsxElement): ManagedIframeContent {
  throw new Error('managed-markup: implement');
}
