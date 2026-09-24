import {caseStudyExample,caseStudyTitle} from '@/lib/document/case-study-example';
/** Creation only. Saved MDX uses the ordinary artifact route and edit mode. */
import {useState} from 'react';
import {Navigate,useNavigate,useParams,useSearchParams} from 'react-router';
import {parseDocumentMdx} from '@/lib/document/mdx';
import {loginHref} from '@/lib/login-href';

const example=`# A document you can shape

Write here. Select **a few words** to change their font, or use the toolbar to add a layout.

<Flex direction="row" sizes={[2,1]}>

<div>

## Room for an idea

This text lives inside a layout. Enter splits a paragraph; Backspace joins it. Try moving a block between columns.

</div>

<div>

## Beside it

Select this layout to reveal its divider, or resize either column.

</div>

</Flex>

<div className="p-6 bg-slate-50 rounded-lg" width={360}>

### Make it yours

Keep writing Markdown inside a styled block. Resize it, change its class, or float it beside your text.

</div>

Ordinary paragraphs remain Markdown. Components keep their properties, and selected text can carry a span class. The rendered document is where you edit.
`;
export function DocumentPage(){
 const {id}=useParams();const navigate=useNavigate();
 const [search]=useSearchParams();const [exampleKind,setExampleKind]=useState(search.get('example')==='case-study'?'case-study':'starter');
 const [title,setTitle]=useState(exampleKind==='case-study'?caseStudyTitle:'Untitled document'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[signIn,setSignIn]=useState(false);
 async function create(){
  if(busy)return;setBusy(true);setError('');setSignIn(false);
  try{
   const response=await fetch('/api/documents',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({title,document:parseDocumentMdx(exampleKind==='case-study'?caseStudyExample:example)})});
   const result=await response.json();
   if(!response.ok){setSignIn(response.status===401);throw Error(response.status===401?'Sign in to create a document.':result.detail??result.error??'Could not create the document.');}
   void navigate(`/a/${result.id}#edit`,{replace:true});
  }catch(e){setError(e instanceof Error?e.message:'Could not create the document.');setBusy(false);}
 }
 if(id)return <Navigate to={`/a/${id}#edit`} replace/>;
 return <main className="mx-auto max-w-xl px-6 py-16">
  <h1 className="text-3xl font-semibold tracking-tight">A document you can shape</h1>
  <p className="mt-3 text-muted">Write directly on the page. Arrange columns, style blocks, and make it yours.</p>
  <form className="mt-8 flex flex-col gap-4" onSubmit={event=>{event.preventDefault();void create();}}>
   <label className="text-sm">Starting point<select aria-label="Starting point" className="mt-2 block w-full rounded-md border border-edge bg-surface px-3 py-2 text-fg" value={exampleKind} onChange={event=>{setExampleKind(event.target.value);setTitle(event.target.value==='case-study'?caseStudyTitle:'Untitled document');}}><option value="starter">Simple editing canvas</option><option value="case-study">cult pitch training — original website</option></select></label>
   <label className="text-sm">Document title<input className="mt-2 block w-full rounded-md border border-edge bg-surface px-3 py-2 text-fg" aria-label="Document title" value={title} maxLength={300} onChange={event=>setTitle(event.target.value)}/></label>
   <button type="submit" disabled={busy} className="self-start rounded-md bg-accent px-4 py-2 text-sm text-white">{busy?'Creating…':'Create document'}</button>
   {error&&<p role="alert">{error} {signIn&&<a className="underline" href={loginHref(window.location)}>Sign in</a>}</p>}
  </form>
 </main>;
}
