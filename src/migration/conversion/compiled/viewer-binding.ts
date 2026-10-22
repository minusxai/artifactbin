import type{CompiledViewerBinding}from'./viewer-contracts.ts';
export function validCompiledViewerBinding(value:unknown):value is CompiledViewerBinding{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;const b=value as CompiledViewerBinding;
 return Object.keys(b).sort().join(',')==='backendHref,backendNamespace'&&b.backendNamespace==='legacyData'&&typeof b.backendHref==='string'&&/^\/af\/v1\/ids\/[A-Za-z0-9]{6}$/.test(b.backendHref);
}
