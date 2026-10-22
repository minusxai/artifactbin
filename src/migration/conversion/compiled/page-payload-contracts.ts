import type {CompiledJavascriptPayload} from './javascript-payload-contracts.ts';
export interface CompiledAsciiPayload extends Omit<CompiledJavascriptPayload,'base64'> {readonly ascii91:string}
export interface CompiledPagePayload {readonly stylesheet:CompiledAsciiPayload|null;readonly javascript:CompiledAsciiPayload}
