/** Dense ASCII transport; excludes HTML delimiters and backslash. */
export function encodeAscii91(bytes:Uint8Array):string {
 const alphabet=Array.from({length:94},(_,i)=>String.fromCharCode(i+33)).filter(c=>!['<','>','\\'].includes(c)).join('');
 let queue=0,bits=0,out='';
 for(const byte of bytes){queue|=byte<<bits;bits+=8;if(bits>13){let value=queue&8191;if(value>88){queue>>>=13;bits-=13;}else{value=queue&16383;queue>>>=14;bits-=14;}out+=alphabet[value%91]!+alphabet[Math.floor(value/91)]!;}}
 if(bits){out+=alphabet[queue%91]!;if(bits>7||queue>90)out+=alphabet[Math.floor(queue/91)]!;}
 return out;
}
/** Self-contained for emission into the page loader. */
export function decodeAscii91(text:string):Uint8Array {
 const alphabet=Array.from({length:94},(_,i)=>String.fromCharCode(i+33)).filter(c=>!['<','>','\\'].includes(c)).join('');
 if(typeof text!=='string'||text.length>4*1024*1024)throw Error('Invalid dense payload');
 let value=-1,queue=0,bits=0;const bytes:number[]=[];
 for(const char of text){const n=alphabet.indexOf(char);if(n<0)throw Error('Invalid dense payload');if(value<0)value=n;else{value+=n*91;queue|=value<<bits;bits+=(value&8191)>88?13:14;while(bits>7){if(bytes.length>=3*1024*1024)throw Error('Dense payload exceeds packed limit');bytes.push(queue&255);queue>>>=8;bits-=8;}value=-1;}}
 if(value>=0)bytes.push((queue|(value<<bits))&255);
 if(bytes.length>3*1024*1024)throw Error('Dense payload exceeds packed limit');
 return Uint8Array.from(bytes);
}
