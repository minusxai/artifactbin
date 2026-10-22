import type {CompiledSlideDeck} from './slide-deck-contracts.ts';
/** Compiler HTML must implement the admitted source order and the exact archived chrome. */
export function reconcileSlideDeckHtml(fragment:unknown,plan:CompiledSlideDeck|undefined):boolean{
 const slides:any[]=[],rows:any[]=[],bars:any[]=[];
 const attr=(n:any,name:string)=>n.attrs?.find((a:any)=>a.name===name)?.value;
 const has=(n:any,name:string)=>(attr(n,'class')??'').split(/\s+/).includes(name);
 const walk=(n:any,inDoc=false,inRail=false)=>{
  const doc=inDoc||has(n,'mx-doc'),rail=inRail||has(n,'mx-rail');
  if(doc&&attr(n,'data-mx-slide')!==undefined)slides.push(n);
  if(rail&&has(n,'mx-rail-row'))rows.push(n);
  if(has(n,'mx-present'))bars.push(n);
  for(const c of n.childNodes??[])walk(c,doc,rail);
 };
 walk(fragment);
 if(!plan)return !slides.length&&!rows.length&&!bars.length;
 if(slides.length!==plan.slides.length||plan.slides.some((s,i)=>s.id!==undefined&&attr(slides[i],'id')!==s.id))return false;
 if(plan.slides.length<2)return rows.length===0&&bars.length===0;
 return bars.length===1&&rows.length===plan.slides.length&&plan.slides.every((s,i)=>attr(rows[i],'aria-label')===`Go to slide ${i+1}: ${s.title}`);
}
