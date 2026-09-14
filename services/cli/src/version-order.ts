/** Release ordering shared by executable updates and monotonic skill installation. */
export const validVersion=(value:unknown):value is string=>typeof value==='string'&&/^\d+\.\d+\.\d+$/.test(value);
export function compareVersions(a:string,b:string):number {
 const x=a.split('.').map(BigInt),y=b.split('.').map(BigInt);
 for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i]?1:-1;
 return 0;
}
