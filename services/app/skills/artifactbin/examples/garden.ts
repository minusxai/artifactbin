/**
 * Example: backend for examples/shared-app.html (linked as data-af-name="budget"): shared monthly
 *   targets per category in the backend store, changed only by signed-in readers.
 * Next: rename the type and fields to your data; keep the store calls and @auth.
 * Usage: publish it together with the page (node scripts/publish.mjs index.html).
 * Gotchas: backend files are published as backend sources, never as public assets. Writes pass
 *   the read version as `expected`, so a concurrent edit fails instead of being overwritten.
 */
interface Target {category:string;amount:number}
interface BudgetState {targets:Target[]}
interface StoreCaps {store:{get():Promise<{value:BudgetState|null;version:number}>;set(value:
  BudgetState,options:{expected:number}):Promise<number>}}
export const typeDefs=`
 type Target { category:String! amount:Float! }
 type Query { targets:[Target!]! }
 type Mutation {
  setTarget(category:String!,amount:Float!):Target! @auth(signedIn:true)
  clearTarget(category:String!):Boolean! @auth(signedIn:true)
 }
`;
export default {
 async targets(_args:unknown,_principal:unknown,caps:StoreCaps){
  const {value}=await caps.store.get();return value?.targets??[];
 },
 async setTarget(args:Target,_principal:unknown,caps:StoreCaps){
  if(!args.category||args.category.length>60||!Number.isFinite(args.amount)||args.amount<0||
   args.amount>1e7)throw Error('Use a category name and a target from 0 to 10,000,000');
  const {value,version}=await caps.store.get();
  const targets=(value?.targets??[]).filter(item=>item.category!==args.category)
   .concat({category:args.category,amount:Math.round(args.amount*100)/100});
  await caps.store.set({targets},{expected:version});
  return targets.at(-1)!;
 },
 async clearTarget(args:{category:string},_principal:unknown,caps:StoreCaps){
  const {value,version}=await caps.store.get();
  await caps.store.set({targets:(value?.targets??[]).filter(item=>item.category!==args.category)},
   {expected:version});
  return true;
 }
};
