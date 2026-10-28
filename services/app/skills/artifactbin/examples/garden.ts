/**
 * Example: backend for examples/shared-app.html (linked as data-af-name="budget"): shared monthly
 *   targets per category, saved by signed-in readers over the page's APP.defaultTargets.
 * Next: rename the type and fields to your data; keep the store calls and @auth. This header
 *   may stay as it is.
 * Usage: publish it together with the page (node scripts/publish.mjs index.html).
 * Gotchas: backend files are published as backend sources, never as public assets. Writes pass
 *   the read version as `expected`, so a concurrent edit is rejected (conflict:true), never
 *   overwritten.
 */
interface Target {category:string;amount:number}
interface BudgetState {targets:Target[]}
interface StoreCaps {store:{get():Promise<{value:BudgetState|null;version:number}>;set(value:
  BudgetState,options:{expected:number}):Promise<number>}}
// Saves answer conflict:true when another edit landed first: the platform reports thrown resolver
// errors only as "Backend execution failed", so the page could not tell a conflict apart.
export const typeDefs=`
 type Target { category:String! amount:Float! }
 type Saved { conflict:Boolean! }
 type Query { signedIn:Boolean! targets(defaults:String):[Target!]! }
 type Mutation {
  setTarget(category:String!,amount:Float!):Saved! @auth(signedIn:true)
  clearTarget(category:String!):Saved! @auth(signedIn:true)
 }
`;
// A concurrent edit is rejected, not overwritten: set throws code 'conflict' and nothing is saved.
const save=(caps:StoreCaps,value:BudgetState,version:number)=>caps.store.set(value,{expected:
 version}).then(()=>({conflict:false}),(error:{code?:string})=>{if(error?.code==='conflict')
 return {conflict:true};throw error;});
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
  return save(caps,{targets},version);
 },
 async clearTarget(args:{category:string},_principal:unknown,caps:StoreCaps){
  const {value,version}=await caps.store.get();
  return save(caps,{targets:(value?.targets??[]).filter(item=>item.category!==args.category)},
   version);
 }
};
