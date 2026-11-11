/** Each table belongs to its declaring app, authentication or events module. */
import { describe, expect, it } from 'vitest';
import { renderedSchema } from '@/__tests__/rendered-schema';

/** The declared tables, keyed "<schema>.<table>" → the owning package. */
const declared = (): Record<string, 'app' | 'auth' | 'events'> => renderedSchema().tables;


describe('table ownership', () => {
  it('every declared table has exactly one owner and no table concept is duplicated across schemas', () => {
    const tables = declared();
    const byName = new Map<string, Set<string>>();
    for (const [qualified, owner] of Object.entries(tables)) {
      const name = qualified.slice(qualified.indexOf('.') + 1);
      const sides = byName.get(name) ?? new Set<string>();
      sides.add(owner);
      byName.set(name, sides);
    }
    const shared = [...byName.entries()].filter(([, sides]) => sides.size > 1).map(([name]) => name);
    expect(shared).toEqual([]);
    expect(tables['auth.credentials']).toBe('auth');
    expect(tables['app.codes']).toBe('app');
  });

  // DROPPED: 'the declared set is exactly the literal'. By its own case name, re-adding a table
  // means touching this test — it asserted that the fixture list above matches itself, and failed
  // for every schema change rather than for any wrong one. The ownership rules below are the test.

  it('rate_limit_hits is declared by NOBODY', () => {
    // The shared-counter backend died with the split's role model; the table
    // is a harmless orphan on deployments that already have it, and a fresh
    // database never creates it.
    const names = Object.keys(declared());
    expect(names.filter((n) => n.endsWith('.rate_limit_hits'))).toEqual([]);
  });
});

it('keeps editor annotation receipts beside app-owned atomic source edits',()=>{
 expect(declared()['app.artifact_edits']).toBe('app');
 expect(renderedSchema().schema).toContain('annotation_changes');
});

it('sharing revision belongs to app artifact state',()=>{expect(renderedSchema().schema).toMatch(/sharing_revision/);});

it('guest workspace adoption belongs to the identity module\'s users',()=>{
 expect(declared()['auth.users']).toBe('auth');
 expect(renderedSchema().schema).toContain('merged_into_user_id TEXT');
});

it('export metadata and refresh claims belong to the app',()=>{expect(declared()['app.export_images']).toBe('app');expect(declared()['app.export_image_cache']).toBe('app');});

it('prerendered Mermaid drawings and their per-version harvests belong to the app, and harvests are erased with their artifact',()=>{
 expect(declared()['app.mermaid_images']).toBe('app');expect(declared()['app.mermaid_harvests']).toBe('app');
 const sql=renderedSchema().schema;
 expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS app\.mermaid_harvests \([\s\S]*?artifact_id TEXT NOT NULL[\s\S]*?PRIMARY KEY \(artifact_id, version, engine\)/);
 expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS app\.mermaid_images \([\s\S]*?PRIMARY KEY \(key\)/);
});

it('fresh schemas omit retired remote identity and work tables',()=>{for(const name of ['remote_agents','remote_work'])expect(declared()['app.'+name]).toBeUndefined();});

it('comment image stages and attachments belong to app',()=>{expect(declared()['app.comment_images']).toBe('app');});

it('membership and its notifications belong to the app',()=>{for(const name of ['relations','member_notifications','user_blocks'])expect(declared()['app.'+name]).toBe('app');});

it('notification outbox and subscriber receipts stay with their existing owners',()=>{expect(declared()['app.event_outbox']).toBe('app');expect(declared()['events.deliveries']).toBe('events');});

it('retired storage is not declared and is dropped from existing databases',()=>{
 const sql=renderedSchema().schema;
 for(const name of ['custom_domains','html_backend_stores','browser_test_users','webfonts','login_codes','oauth_codes','remote_agents','remote_work']){
  expect(declared()['app.'+name]).toBeUndefined();
  expect(sql).toContain(`DROP TABLE IF EXISTS app.${name};`);
  expect(sql).not.toMatch(new RegExp(`(?:CREATE|ALTER) TABLE(?: IF NOT EXISTS)? app\\.${name}\\b`));
 }
});

it('canonical document storage belongs to artifact heads and archived versions',()=>{
 const sql=renderedSchema().schema;
 for(const table of ['artifacts','artifact_versions'])expect(sql).toMatch(new RegExp('CREATE TABLE IF NOT EXISTS app\\.'+table+' \\([\\s\\S]*?document JSONB'));
});

it('atomic document operations keep baseline state in the app edit log',()=>{
 expect(renderedSchema().schema).toContain('document_state JSONB');
 expect(renderedSchema().schema).toContain('document_archived_at TIMESTAMPTZ');
});

it('artifact heads and archived versions have no content column',()=>{
 const sql=renderedSchema().schema;
 for(const table of ['artifacts','artifact_versions']){
  const declaration=sql.split(`CREATE TABLE IF NOT EXISTS app.${table} (`)[1]?.split(');')[0];
  expect(declaration).toBeDefined();expect(declaration).not.toMatch(/\bcontent TEXT/);
  expect(sql).toContain(`ALTER TABLE app.${table} DROP COLUMN IF EXISTS content`);
 }
});

it('retired mutation-notification storage is declared by nobody and dropped on boot',()=>{
 for(const name of ['notification_jobs','mutation_notifications']){expect(declared()['app.'+name]).toBeUndefined();expect(renderedSchema().schema).toContain('DROP TABLE IF EXISTS app.'+name);}
 expect(renderedSchema().schema).toContain('context JSONB');
});
it('artifact-specific consent lives on the existing app relation',()=>{expect(declared()['app.relations']).toBe('app');expect(renderedSchema().schema).toContain('explicit_join BOOLEAN NOT NULL DEFAULT false');});

it('the removed page functions\' storage is declared by nobody and never dropped: its rows stay, unread, for their owners',()=>{
 const sql=renderedSchema().schema;
 for(const table of ['html_backend_versions','html_backend_secrets','page_function_schedules','runner_runs','runner_events','hosted_conversations','hosted_branches','runner_schedules','runner_schedule_attempts','runner_schedule_occurrences']){
  expect(declared()['app.'+table],table).toBeUndefined();
  if(!['hosted_conversations','hosted_branches'].includes(table))expect(sql,table).not.toMatch(new RegExp(`(?:CREATE|ALTER|DROP) TABLE(?: IF (?:NOT )?EXISTS)? app\\.${table}\\b`));
 }
});
it('the pages sessions behind the documents\' own origins belong to the app and store only a cookie hash',()=>{
 expect(declared()['app.pages_sessions']).toBe('app');
 expect(renderedSchema().schema).toMatch(/CREATE TABLE IF NOT EXISTS app\.pages_sessions \([\s\S]*?id_hash TEXT NOT NULL[\s\S]*?PRIMARY KEY \(id_hash\)/);
});
it('a reader\'s document trust belongs to the app, one row per person per document, erased with the person',()=>{
 expect(declared()['app.document_trust']).toBe('app');
 expect(renderedSchema().schema).toMatch(/CREATE TABLE IF NOT EXISTS app\.document_trust \([\s\S]*?user_id TEXT NOT NULL[\s\S]*?extensions JSONB NOT NULL[\s\S]*?PRIMARY KEY \(user_id, artifact_id\)/);
});
it('a group\'s approved addresses belong to the app, one row per group, data directive and exact host, never keyed on user_id',()=>{
 expect(declared()['app.group_trust']).toBe('app');
 expect(renderedSchema().schema).toMatch(/CREATE TABLE IF NOT EXISTS app\.group_trust \([\s\S]*?created_by TEXT NOT NULL[\s\S]*?PRIMARY KEY \(group_id, directive, host\)[\s\S]*?directive IN \('connect','img','media'\)/);
 expect(renderedSchema().schema).not.toMatch(/app\.group_trust ADD COLUMN IF NOT EXISTS user_id/);
});

it('optional comment view state stays with app-owned annotations', () => {
  expect(declared()['app.annotations']).toBe('app');
  expect(renderedSchema().schema).toContain('view_state JSONB');
});
it('the hot-path indexes are declared, created at boot only when missing, and partial where the live rows are what is read',()=>{
 const sql=renderedSchema().schema;
 expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_artifacts_group_updated ON app.artifacts (group_id, updated_at DESC) WHERE deleted_at IS NULL');
 expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_artifact_shares_user ON app.artifact_shares (user_id)');
 expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_artifact_shares_email ON app.artifact_shares (email)');
 // The unique (group_id, email) index stays; the lookup by address alone is a second, plain one.
 expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_group_invitations_email ON auth.group_invitations (group_id, email)');
 expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_group_invitations_by_email ON auth.group_invitations (email)');
});

it('native identity provenance belongs to the app and preserves multiple verified aliases',()=>{
 expect(declared()['app.native_identity_imports']).toBe('app');
 const sql=renderedSchema().schema;
 expect(sql).toContain('PRIMARY KEY (source_namespace, kind, source_id)');
 expect(sql).toContain('CREATE INDEX IF NOT EXISTS idx_native_identity_imports_target');
 expect(sql).not.toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_native_identity_imports_target');
});

it('account comment reactions belong to the app',()=>{expect(declared()['app.comment_reactions']).toBe('app');expect(declared()['app.comment_reaction_events']).toBeUndefined();});

it('group mail retries and fenced claims belong to the identity module\'s durable state',()=>{
 expect(declared()['auth.group_mail_outbox']).toBe('auth');
 const declaration=renderedSchema().schema.split('CREATE TABLE IF NOT EXISTS auth.group_mail_outbox (')[1]?.split(');')[0];
 for(const column of ['claim_token TEXT','attempts INTEGER NOT NULL DEFAULT 0','next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now()','quarantined_at TIMESTAMPTZ'])expect(declaration).toContain(column);
});
it('the head\'s content publisher column stays on the app\'s artifacts, kept with its data',()=>{
 const sql=renderedSchema().schema;
 expect(declared()['app.artifacts']).toBe('app');
 expect(sql).toContain('ALTER TABLE app.artifacts ADD COLUMN IF NOT EXISTS content_publisher_user_id TEXT');
});
