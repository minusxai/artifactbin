/**
 * Example: resolver for examples/shared-app.html (linked as data-af-name="budget"): validated
 *   shared monthly targets, stored as rows of the page's "targets" dataset (category, amount).
 * Next: rename the fields to your data; keep caps.query, the checks and @auth. This header may
 *   stay as it is.
 * Usage: publish it with the page (node scripts/publish.mjs index.html). caps.query runs as the
 *   caller, so the targets dataset's rules must let viewer and signed_in add, change and delete
 *   rows (examples/shared-app-policy.mjs writes them).
 * Gotchas: there is no upsert: read the row, then update it by _id or insert one. Plain reads need
 *   no resolver (the page reads targets directly); use one for checks, derived values or external
 *   data. A saved row overrides the page's APP.defaultTargets; clearing deletes it.
 */
interface Target {category:string;amount:number}
interface Caps {query(graphql:string,variables?:Record<string,unknown>):Promise<any>}
export const typeDefs=`
 type Target { category:String! amount:Float! }
 type Query { signedIn:Boolean! }
 type Mutation {
  setTarget(category:String!,amount:Float!):Target! @auth(role:signed_in)
  clearTarget(category:String!):Int! @auth(role:signed_in)
 }
`;
const FIND=`query Find($c:String!){targets(where:{category:{_eq:$c}}){_id}}`;
const UPDATE=`mutation Update($id:ID!,$a:Float!){update_targets_by_pk(pk_columns:{_id:$id},
 _set:{amount:$a}){category amount}}`;
const INSERT=`mutation Insert($o:targets_insert_input!){insert_targets_one(object:$o){category amount}}`;
const CLEAR=`mutation Clear($c:String!){delete_targets(where:{category:{_eq:$c}}){affected_rows}}`;
export default {
 // Lets the page show guests why they can't edit; @auth still enforces it on every write.
 signedIn:(_args:unknown,principal:{subject:string|null})=>principal?.subject!=null,
 async setTarget(args:Target,_principal:unknown,caps:Caps):Promise<Target>{
  const category=args.category.trim();
  if(!category||category.length>60||!Number.isFinite(args.amount)||args.amount<0||args.amount>1e7)
   throw Error('Use a category name and a target from 0 to 10,000,000');
  const amount=Math.round(args.amount*100)/100,[row]=(await caps.query(FIND,{c:category})).targets;
  if(row)return (await caps.query(UPDATE,{id:row._id,a:amount})).update_targets_by_pk;
  return (await caps.query(INSERT,{o:{category,amount}})).insert_targets_one;
 },
 async clearTarget(args:{category:string},_principal:unknown,caps:Caps):Promise<number>{
  return (await caps.query(CLEAR,{c:args.category.trim()})).delete_targets.affected_rows;
 }
};
