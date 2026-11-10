/**
 * Example: the tracker's features (examples/tracker.html): what each needs, the columns and files
 *   it adds, and how it changes the entries dataset's rules; the presets new-app.mjs offers.
 * Usage: node scripts/new-app.mjs --kind tracker [--preset tasks|list] [--without F,…] [--limit N]
 *   reads it; no edits needed.
 * Gotchas: own-rows and team change who may do what, so they live in the dataset rules: the
 *   page only shows matching controls (from tracker.ts me), and the rules judge every write.
 */
export const FEATURES = {
  'own-rows': {requires: [],
    summary: 'signed-in people add entries and change or remove only their own'},
  team: {requires: ['own-rows'],
    summary: 'people the page is shared with change and remove every entry'},
  collab: {requires: [], columns: ['description'],
    summary: 'descriptions are typed in together, live'},
  table: {requires: [], summary: 'a sortable table view of every entry'},
  limits: {requires: ['own-rows'],
    summary: 'each group holds at most APP.limit entries'},
};
/** Each preset's features, and the [bracketed] APP texts it starts from (tasks: the page's own). */
export const PRESETS = {
  tasks: {features: Object.keys(FEATURES), texts: {}},
  list: {features: ['own-rows'], texts: {
    '[Team · quarter]': '[Event · dates]',
    '[What we are working on, and who has it.]': '[What people sign up for, and what to bring.]',
    '[Task]': '[Name]', '[Status]': '[Shift]', '[Owner or note (optional)]':
      '[Bringing or note (optional)]', '[Add task]': '[Sign up]',
    '[To do]': '[First choice]', '[Doing]': '[Second choice]', '[Done]': '[Third choice]'}},
};
/** The entries dataset's columns for the kept features (the CSV header new-app.mjs publishes). */
export const columns = keep => ['name', 'grp', 'note', 'created_by',
  ...Object.entries(FEATURES).filter(([name]) => keep.has(name))
    .flatMap(([, feature]) => feature.columns ?? [])];
/** The dataset template the rules start from: own-rows (owner column created_by) or read-only. */
export const template = keep => keep.has('own-rows') ? 'own-rows' : 'read-only';
/** The entries table's rules for the kept features, from the template's table. */
export function rules(table, keep) {
  const t = structuredClone(table);
  if (!keep.has('own-rows'))
    for (const k of ['insert_permissions', 'update_permissions', 'delete_permissions']) delete t[k];
  if (keep.has('team')) {
    t.update_permissions = (t.update_permissions ?? []).map(e => e.role === 'viewer'
      ? {role: 'viewer', permission: {...e.permission, filter: {}, check: {}}} : e);
    t.delete_permissions = (t.delete_permissions ?? []).map(e => e.role === 'viewer'
      ? {role: 'viewer', permission: {filter: {}}} : e);
  }
  if (keep.has('collab')) t.collaborative_columns = ['description'];
  return t;
}
