/**
 * Example backend for examples/shared-app.html (publish them together): TypeScript resolvers over a shared store with
 * role-protected mutations. It demonstrates typeDefs plus resolvers; the page links it with af-backend.
 * Backend files are published as backend sources, never as public assets.
 */
interface Job {id:string;title:string;done:boolean}
interface GardenState {jobs:Job[]}
interface StoreCaps {store:{get():Promise<{value:GardenState|null;version:number}>;set(value:
  GardenState,options:{expected:number}):Promise<number>}}
export const typeDefs=`
 type Job { id:ID! title:String! done:Boolean! }
 type Query { jobs:[Job!]! }
 type Mutation { setDone(id:ID!,done:Boolean!):Job! @auth(role:EDITOR) }
`;
const initial=[{id:'mulch',title:'Mulch the north beds',done:false},{id:'tools',title:
  'Clean and return shared tools',done:false},{id:'water',title:'Water the new seedlings',done:
  false}];
export default {
async jobs(_args:unknown,_principal:unknown,caps:StoreCaps){const {value}=await caps.store.get();
   return value?.jobs??initial;},
 async setDone(args:{id:string;done:boolean},_principal:unknown,caps:StoreCaps){
  const {value,version}=await caps.store.get();
  const jobs=(value?.jobs??initial).map(job=>({...job}));
  const job=jobs.find(job=>job.id===args.id);if(!job)throw Error('Unknown job');
  job.done=args.done;
  await caps.store.set({jobs},{expected:version});
  return job;
 }
};
