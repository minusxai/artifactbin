/**
 * Example: backend for examples/shared-app.html (linked as data-af-name="budget"): shared monthly
 *   targets per category, saved by signed-in readers over the page's APP.defaultTargets.
 * Next: rename the type and fields to your data; keep the store calls and @auth. This header
 *   may stay as it is.
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
 type Query { signedIn:Boolean! targets(defaults:String):[Target!]! }
 type Mutation {
  setTarget(category:String!,amount:Float!):Target! @auth(signedIn:true)
  clearTarget(category:String!):Boolean! @auth(signedIn:true)
 }
`;
export default {
 // Lets the page show guests why they can't edit; @auth still enforces it on every write.
 signedIn:(_args:unknown,principal:{subject:string|null})=>principal?.subject!=null,
 // The page's defaults (JSON {category:amount}), saved targets on top (an empty store adds none).
 async targets(args:{defaults?:string},_principal:unknown,caps:StoreCaps){
  let defaults:Record<string,unknown>={};
  try{defaults=JSON.parse(args.defaults||'{}')??{};}catch{/* malformed: saved targets only */}
  const {value}=await caps.store.get(),merged:Record<string,unknown>={...defaults};
  for(const item of value?.targets??[])merged[item.category]=item.amount;
  return Object.entries(merged).filter(([,amount])=>typeof amount==='number'&&amount>=0)
   .map(([category,amount])=>({category,amount}));
 },
 async setTarget(args:Target,_principal:unknown,caps:StoreCaps){
  if(!args.category||args.category.length>60||!Number.isFinite(args.amount)||args.amount<0||
   args.amount>1e7)throw Error('Use a category name and a target from 0 to 10,000,000');
  const {value,version}=await caps.store.get();
  const targets=(value?.targets??[]).filter(item=>item.category!==args.category)
   .concat({category:args.category,amount:Math.round(args.amount*100)/100});
  // A concurrent edit is rejected, not overwritten: set throws, the page shows the error, and its
  // onBackendChange reload already holds the newer targets for the editor to save again.
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
