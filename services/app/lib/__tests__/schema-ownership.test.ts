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

it('remote identities and work receipts belong to app',()=>{expect(declared()['app.remote_agents']).toBe('app');expect(declared()['app.remote_work']).toBe('app');});

it('comment image stages and attachments belong to app',()=>{expect(declared()['app.comment_images']).toBe('app');});

it('membership and its notifications belong to the app',()=>{for(const name of ['artifact_members','member_notifications','user_blocks'])expect(declared()['app.'+name]).toBe('app');});
