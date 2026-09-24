import {expect,it} from 'vitest';
import type {DocumentEdit,DocumentEditResult} from '@artifactbin/contracts';
import {DocumentSession} from '../session';
import {parseDocumentMdx} from '../mdx';
import {applyDocumentOperations} from '../model';
it('buffers typing during a save and uses the accepted version for the next edit',async()=>{
 const document=parseDocumentMdx('Hello');const id=document.nodes[document.rootId].children![0];
 const requests:DocumentEdit[]=[];let finish!:(r:DocumentEditResult)=>void;
 const session:DocumentSession=new DocumentSession({id:'doc123',version:1,document},request=>{requests.push(request);return new Promise(resolve=>{finish=resolve;});});
 const change=(value:string)=>{const d=structuredClone(session.document);d.nodes[id].props.className=value;session.update(d);};
 change('first');const saving=session.flush();change('second');
 finish({updated:true,version:2,document:applyDocumentOperations(document,requests[0].operations)});await saving;
 expect(session.document.nodes[id].props.className).toBe('second');const next=session.flush();expect(requests[1].baseVersion).toBe(2);
 finish({updated:true,version:3,document:session.document});await next;expect(session.status).toBe('saved');
});
it('preserves a conflicting draft and never silently overwrites it',async()=>{
 const document=parseDocumentMdx('Hello');const session:DocumentSession=new DocumentSession({id:'doc123',version:1,document},async()=>({updated:false,reason:'conflict',version:2}));
 const draft=structuredClone(document);draft.nodes[draft.rootId].props.className='draft';session.update(draft);await session.flush();expect(session.status).toBe('conflict');expect(session.document).toEqual(draft);
});
it('retries an uncertain network result with the same operation ID',async()=>{
 const document=parseDocumentMdx('Hello');const requests:DocumentEdit[]=[];
 const session:DocumentSession=new DocumentSession({id:'doc123',version:1,document},async request=>{requests.push(request);if(requests.length===1)throw Error('offline');return {updated:false,reason:'duplicate',version:2,document:session.document};});
 const draft=structuredClone(document);draft.nodes[draft.rootId].props.className='draft';session.update(draft);await session.flush();expect(session.status).toBe('offline');await session.flush();expect(requests[0]).toEqual(requests[1]);expect(session.status).toBe('saved');
});
it('does not advance buffered edits past an overlapping independent server change',async()=>{
 const document=parseDocumentMdx('First\n\nSecond'),[a,b]=document.nodes[document.rootId].children!;
 let finish!:(result:DocumentEditResult)=>void;
 const session=new DocumentSession({id:'doc123',version:1,document},()=>new Promise(resolve=>{finish=resolve;}));
 const sent=structuredClone(document);sent.nodes[a].props.className='first';session.update(sent);const saving=session.flush();
 const draft=structuredClone(sent);draft.nodes[b].props.className='my buffered edit';session.update(draft);
 const accepted=structuredClone(sent);accepted.nodes[b].props.className='other user';finish({updated:true,version:3,document:accepted});await saving;
 expect(session.status).toBe('conflict');expect(session.document).toEqual(draft);
});
