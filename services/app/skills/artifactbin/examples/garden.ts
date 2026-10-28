/**
 * Example: backend for examples/shared-app.html: TypeScript resolvers over a shared store with
 *   a signed-in-only mutation. It demonstrates typeDefs plus resolvers; the page links it with
 *   af-backend.
 * Usage: publish it together with the page (node scripts/publish.mjs examples/shared-app.html).
 * Gotchas: backend files are published as backend sources, never as public assets. Writes pass
 *   the read version as `expected`, so a concurrent edit fails instead of being overwritten.
 */
interface Target {week:string;target:number}
interface GardenState {targets:Target[]}
interface StoreCaps {store:{get():Promise<{value:GardenState|null;version:number}>;set(value:
  GardenState,options:{expected:number}):Promise<number>}}
export const typeDefs=`
 type Target { week:String! target:Int! }
 type Query { targets:[Target!]! }
 type Mutation { setTarget(week:String!,target:Int!):Target! @auth(signedIn:true) }
`;
export default {
 async targets(_args:unknown,_principal:unknown,caps:StoreCaps){
  const {value}=await caps.store.get();return value?.targets??[];},
 async setTarget(args:{week:string;target:number},_principal:unknown,caps:StoreCaps){
  if(!/^\d{4}-W\d{2}$/.test(args.week)||!Number.isInteger(args.target)||args.target<0||
    args.target>999)throw Error('Use a week like 2026-W01 and a target from 0 to 999');
  const {value,version}=await caps.store.get();
  const targets=(value?.targets??[]).filter(item=>item.week!==args.week).concat({week:args.week,
    target:args.target});
  // Conditional on the version read: a concurrent change fails instead of being overwritten.
  await caps.store.set({targets},{expected:version});
  return {week:args.week,target:args.target};
 }
};
