import {beforeEach, describe, expect, it, vi} from 'vitest';
import {GET as list} from '@/app/api/admin/documents/route';
import {GET, PUT} from '@/app/api/admin/documents/[id]/route';
import {getArtifactFor} from '@/lib/artifacts';
import {useAppHarness, request} from './harness';
import type {Actor} from '@artifactbin/contracts';

const harness = useAppHarness();
const admin: Actor = {credential:'session',userId:'usr_admin',email:'Admin@Example.com',emailVerified:true};
const context = {params:Promise.resolve({id:'abc123'})};
const req = (method='GET', json?:unknown, actor:Actor=admin, mode=true) => request('/api/admin/documents/abc123', {method, actor, origin:'same', ...(json===undefined?{}:{json}), headers:mode?{'X-Artifactbin-Admin':'1'}:{}});
beforeEach(async()=>{
  vi.stubEnv('ADMIN__EMAILS',' admin@example.com, other@example.com ');
  const db=await harness.db();
  await db.query("INSERT INTO artifacts(id,token_id,user_id,title,source,content,format,visibility,edit_id) VALUES ('abc123','tok_owner','usr_owner','Private document','<p id=\"intro\">Before</p>','','markup','private','base-edit')");
});

describe('explicit email-authorized admin repairs',()=>{
  it('requires verified identity and explicit mode, and defaults to disabled',async()=>{
    for(const actor of [{...admin,emailVerified:false},{...admin,email:'other@evil.test'},{credential:'none' as const},{...admin,credential:'agent-cookie' as const}])expect((await GET(req('GET',undefined,actor),context)).status).toBe(404);
    expect((await GET(req('GET',undefined,admin,false),context)).status).toBe(404);
    vi.stubEnv('ADMIN__EMAILS','');expect((await GET(req(),context)).status).toBe(404);
  });
  it('reads another owner’s source and audits the actual operator',async()=>{
    const response=await GET(req(),context);
    expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({id:'abc123',source:'<p id="intro">Before</p>',edit_id:'base-edit'});
    expect((await (await harness.db()).query('SELECT actor_user_id,action,artifact_id FROM admin_document_audit')).rows).toEqual([{actor_user_id:'usr_admin',action:'read',artifact_id:'abc123'}]);
    expect(await getArtifactFor({userId:'usr_admin',tokenId:''},'abc123')).toBeNull();
  });
  it('accepts current verified bearer identity and rechecks the allowlist each request',async()=>{
    const actor={...admin,credential:'bearer' as const,tokenId:'tok_admin'};
    expect((await GET(req('GET',undefined,actor),context)).status).toBe(200);
    vi.stubEnv('ADMIN__EMAILS','someone@example.com');expect((await GET(req('GET',undefined,actor),context)).status).toBe(404);
  });
  it('rejects cross-origin cookies, forged headers and browser-session elevation',async()=>{
    const cross=request('/api/admin/documents/abc123',{actor:admin,origin:'https://evil.test',headers:{'X-Artifactbin-Admin':'1'}});
    expect((await GET(cross,context)).status).toBe(403);
    expect((await GET(request('/api/admin/documents/abc123',{headers:{'X-Artifactbin-Admin':'1','x-mx-actor':JSON.stringify(admin)}}),context)).status).toBe(404);
    expect((await GET(request('/api/admin/documents/abc123',{actor:admin,headers:{'X-Artifactbin-Admin':'1','x-mx-browser-session':'1'}}),context)).status).toBe(404);
  });
  it('lists matching live markup only and returns a bounded cursor',async()=>{
    const db=await harness.db();await db.query("INSERT INTO artifacts(id,token_id,title,source,content,format) VALUES ('data12','tok_owner','Private dataset','<Dataset />','','dataset')");
    const response=await list(request('/api/admin/documents?q=Before',{actor:admin,headers:{'X-Artifactbin-Admin':'1'}}));
    expect(response.status).toBe(200);expect((await response.json()).documents.map((row:{id:string})=>row.id)).toEqual(['abc123']);
  });
  it('repairs atomically, preserves ownership and records version history under the admin',async()=>{
    const response=await PUT(req('PUT',{edit_id:'base-edit',source:'<p id="intro">After</p>',reason:'Repair legacy script'}),context);
    expect(response.status).toBe(200);const updated=await response.json();expect(updated).toMatchObject({version:2,source:'<p id="intro">After</p>'});
    const db=await harness.db();expect((await db.query('SELECT user_id,actor_user_id,visibility FROM artifacts WHERE id=$1',['abc123'])).rows[0]).toEqual({user_id:'usr_owner',actor_user_id:'usr_admin',visibility:'private'});
    expect((await db.query('SELECT source FROM artifact_versions WHERE artifact_id=$1',['abc123'])).rows[0].source).toBe('<p id="intro">Before</p>');
    expect((await db.query("SELECT reason,after_version FROM admin_document_audit WHERE action='repair'")).rows[0]).toEqual({reason:'Repair legacy script',after_version:2});
    expect((await PUT(req('PUT',{edit_id:'base-edit',source:'<p>stale</p>',reason:'retry'}),context)).status).toBe(409);
  });
  it('refuses invalid source, missing reason and metadata changes without updating the document',async()=>{
    for(const body of [{edit_id:'base-edit',source:'<p>Changed</p>'},{edit_id:'base-edit',source:'<script>alert(1)</script>',reason:'repair'},{edit_id:'base-edit',source:'<p>Changed</p>',reason:'repair',visibility:'public'}])expect((await PUT(req('PUT',body),context)).status).toBe(400);
    expect((await (await harness.db()).query('SELECT version FROM artifacts WHERE id=$1',['abc123'])).rows[0].version).toBe(1);
  });

  it('rolls source, history and identity back when audit persistence fails',async()=>{
    const db=await harness.db();
    await db.query("ALTER TABLE admin_document_audit ADD CONSTRAINT reject_repair CHECK(action <> 'repair')");
    try {
      await expect(PUT(req('PUT',{edit_id:'base-edit',source:'<p id="intro">After</p>',reason:'repair'}),context)).rejects.toThrow();
      expect((await db.query('SELECT version,edit_id,source FROM artifacts WHERE id=$1',['abc123'])).rows[0]).toEqual({version:1,edit_id:'base-edit',source:'<p id="intro">Before</p>'});
      expect((await db.query('SELECT 1 FROM artifact_versions')).rows).toHaveLength(0);
      expect((await db.query('SELECT 1 FROM artifact_edits')).rows).toHaveLength(0);
    }finally{await db.query('ALTER TABLE admin_document_audit DROP CONSTRAINT reject_repair');}
  });

});
