import {GET as pageGET} from '@/app/api/page/artifact/[id]/route';
import {expect,it} from 'vitest';
import {request,useAppHarness} from './harness';
import {mintToken} from '@/lib/tokens';
import {POST} from '@/app/api/documents/route';
import {GET,PATCH} from '@/app/api/documents/[id]/route';
import {parseDocumentMdx} from '@/lib/document/mdx';
useAppHarness();
it('creates, reads and edits through authenticated handlers',async()=>{
 const {token}=await mintToken('mdx-test');const document=parseDocumentMdx('Hello');
 const created=await POST(request('/api/documents',{method:'POST',token,json:{title:'MDX',document}}));expect(created.status).toBe(201);
 const body=await created.json();const ctx={params:Promise.resolve({id:body.id})};
 const read=await GET(request(`/api/documents/${body.id}`,{token}),ctx);expect(read.status).toBe(200);expect((await read.json()).document).toEqual(document);
 const id=document.nodes[document.rootId].children![0];
 const edited=await PATCH(request(`/api/documents/${body.id}`,{method:'PATCH',token,json:{baseVersion:1,operationId:'test-edit',changedIds:[id],ancestorIds:[document.rootId],operations:[{kind:'set',nodeId:id,path:['props','className'],value:'font-mono'}]}}),ctx);
 expect(edited.status).toBe(200);expect(await edited.json()).toMatchObject({updated:true,version:2});
});
it('rejects malformed input and unauthenticated writes',async()=>{
 const {token}=await mintToken('mdx-test');
 expect((await POST(request('/api/documents',{method:'POST',token,json:{document:{}}}))).status).toBe(400);
 expect((await POST(request('/api/documents',{method:'POST',json:{document:{}}}))).status).toBe(401);
});
it('accepts a same-site account session and rejects a cross-site write',async()=>{
 const actor={credential:'session' as const,userId:'mdx-session-user',email:'mxmx_test_session@example.com',emailVerified:true};
 const document=parseDocumentMdx('Session editing');
 const accepted=await POST(request('/api/documents',{method:'POST',actor,origin:'same',json:{title:'Session',document}}));expect(accepted.status).toBe(201);
 const refused=await POST(request('/api/documents',{method:'POST',actor,origin:'https://other.example',json:{title:'Session',document}}));expect(refused.status).toBe(403);
});

it('serves MDX through the real artifact surface instead of a custom route',async()=>{
 const actor={credential:'session' as const,userId:'mdx-shell-user',email:'mxmx_test_shell@example.com',emailVerified:true};
 const document=parseDocumentMdx('# Integrated');
 const created=await POST(request('/api/documents',{method:'POST',actor,origin:'same',json:{title:'Integrated',document}}));
 const {id}=await created.json();
 const response=await pageGET(request(`/api/page/artifact/${id}`,{actor}),{params:Promise.resolve({id})});
 expect(response.status).toBe(200);const page=await response.json();
 expect(page.canonical).not.toContain('/documents/');
 expect(page.surface).toMatchObject({id,document});
});
it('renders an archived MDX snapshot through artifact history',async()=>{
 const actor={credential:'session' as const,userId:'mdx-history-user',email:'mxmx_test_history@example.com',emailVerified:true};
 const document=parseDocumentMdx('Original paragraph');
 const created=await POST(request('/api/documents',{method:'POST',actor,origin:'same',json:{title:'History',document}}));const {id}=await created.json();
 const nodeId=document.nodes[document.rootId].children![0];
 const edited=await PATCH(request(`/api/documents/${id}`,{method:'PATCH',actor,origin:'same',json:{baseVersion:1,operationId:'archive-test',changedIds:[nodeId],ancestorIds:[document.rootId],operations:[{kind:'set',nodeId,path:['content','0','text'],value:'Changed paragraph'}]}}),{params:Promise.resolve({id})});
 expect(edited.status).toBe(200);
 const response=await pageGET(request(`/api/page/artifact/${id}?version=1`,{actor}),{params:Promise.resolve({id})});
 const page=await response.json();expect(page.surface.source).toContain('Original paragraph');expect(page.surface.source).not.toContain('Changed paragraph');expect(page.archived).toEqual({version:1,head:2});
});
