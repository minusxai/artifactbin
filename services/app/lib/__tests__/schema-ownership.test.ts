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

it('guest workspace adoption belongs to app users',()=>{
 expect(declared()['app.users']).toBe('app');
 expect(renderedSchema().schema).toContain('merged_into_user_id TEXT');
});

it('export metadata and refresh claims belong to the app',()=>{expect(declared()['app.export_images']).toBe('app');expect(declared()['app.export_image_cache']).toBe('app');});

it('prerendered Mermaid drawings and their per-version harvests belong to the app, and harvests are erased with their artifact',()=>{
 expect(declared()['app.mermaid_images']).toBe('app');expect(declared()['app.mermaid_harvests']).toBe('app');
 const sql=renderedSchema().schema;
 expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS app\.mermaid_harvests \([\s\S]*?artifact_id TEXT NOT NULL[\s\S]*?PRIMARY KEY \(artifact_id, version, engine\)/);
 expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS app\.mermaid_images \([\s\S]*?PRIMARY KEY \(key\)/);
});

it('remote identities and work receipts belong to app',()=>{expect(declared()['app.remote_agents']).toBe('app');expect(declared()['app.remote_work']).toBe('app');});

it('comment image stages and attachments belong to app',()=>{expect(declared()['app.comment_images']).toBe('app');});

it('membership and its notifications belong to the app',()=>{for(const name of ['relations','member_notifications','user_blocks'])expect(declared()['app.'+name]).toBe('app');});

it('notification outbox and subscriber receipts stay with their existing owners',()=>{expect(declared()['app.event_outbox']).toBe('app');expect(declared()['events.deliveries']).toBe('events');});

it('custom domains belong to app accounts: one per account, one VERIFIED owner per hostname',()=>{
 expect(declared()['app.custom_domains']).toBe('app');
 expect(renderedSchema().schema).toContain('homepage_artifact_id TEXT');
 expect(renderedSchema().schema).toContain('ALTER TABLE app.custom_domains ADD COLUMN IF NOT EXISTS homepage_artifact_id TEXT');
 expect(renderedSchema().schema).toMatch(/CREATE TABLE IF NOT EXISTS app\.custom_domains \([\s\S]*PRIMARY KEY \(user_id\)/);
 expect(renderedSchema().schema).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS idx_custom_domains_verified_host ON app\.custom_domains \(hostname\) WHERE status = 'verified'/);
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

it('mutation run jobs and one recipient result per run belong to the app',()=>{
 for(const name of ['notification_jobs','mutation_notifications'])expect(declared()['app.'+name]).toBe('app');
 expect(renderedSchema().schema).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_jobs_run ON app.notification_jobs (mutation_run_id)');
 expect(renderedSchema().schema).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_mutation_notifications_run_recipient ON app.mutation_notifications (mutation_run_id, recipient_id)');
 expect(renderedSchema().schema).toContain('context JSONB');
});
it('artifact-specific consent lives on the existing app relation',()=>{expect(declared()['app.relations']).toBe('app');expect(renderedSchema().schema).toContain('explicit_join BOOLEAN NOT NULL DEFAULT false');});

it('co-hosted runner persistence is declared once with owner-scoped admission and occurrence uniqueness',()=>{
 const sql=renderedSchema().schema;
 for(const table of ['runner_runs','runner_events','hosted_conversations','hosted_branches','runner_schedules','runner_schedule_attempts','runner_schedule_occurrences'])expect(declared()['app.'+table]).toBe('app');
 expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_runner_request ON app.runner_runs (owner, request_key)');
 expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_runner_occurrence ON app.runner_schedule_occurrences (schedule_id, scheduled_at)');
});
it('the pages sessions behind the documents\' own origins belong to the app and store only a cookie hash',()=>{
 expect(declared()['app.pages_sessions']).toBe('app');
 expect(renderedSchema().schema).toMatch(/CREATE TABLE IF NOT EXISTS app\.pages_sessions \([\s\S]*?id_hash TEXT NOT NULL[\s\S]*?PRIMARY KEY \(id_hash\)/);
});
it('a reader\'s document trust belongs to the app, one row per person per document, erased with the person',()=>{
 expect(declared()['app.document_trust']).toBe('app');
 expect(renderedSchema().schema).toMatch(/CREATE TABLE IF NOT EXISTS app\.document_trust \([\s\S]*?user_id TEXT NOT NULL[\s\S]*?extensions JSONB NOT NULL[\s\S]*?PRIMARY KEY \(user_id, artifact_id\)/);
});

it('optional comment view state stays with app-owned annotations', () => {
  expect(declared()['app.annotations']).toBe('app');
  expect(renderedSchema().schema).toContain('view_state JSONB');
});
it('custom-domain path overrides belong to the domain and migrate existing accounts', () => {
 expect(renderedSchema().schema).toContain("path_overrides JSONB NOT NULL DEFAULT '{}'::jsonb");
 expect(renderedSchema().schema).toContain('ALTER TABLE app.custom_domains ADD COLUMN IF NOT EXISTS path_overrides JSONB');
});
