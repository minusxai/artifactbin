/** randomUUID requires a secure browser context; getRandomValues also works on local HTTP. */
export function newRequestId():string{
 if(typeof globalThis.crypto?.randomUUID==='function')return globalThis.crypto.randomUUID();
 if(typeof globalThis.crypto?.getRandomValues!=='function')throw Error('Secure random values are unavailable.');
 const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]!&0x0f)|0x40;bytes[8]=(bytes[8]!&0x3f)|0x80;
 const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}
