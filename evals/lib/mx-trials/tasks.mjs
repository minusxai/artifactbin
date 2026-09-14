import { artifactIdFromPath } from '@artifactbin/utils/artifact-reference';
/** Fixed held-out briefs. The grader and these reference checks are never staged for the agent. */
export const sessionTasks = {
  multi: 'Open both supplied artifacts concurrently in ONE session. Set the first region to South with a Playwright control and leave the second at North. In a second CLI script call, resume the same pages and return both settled sales snapshots.',
  resume: 'Open the first artifact and set window.probeMarker="still-here" and set the artifact\'s region signal to South. In a SECOND CLI script call resume that exact page (do not navigate again), and return the marker and region.',
  capture: 'Open the first artifact and set its region signal to South. In a SECOND CLI script call resume that same page, wait for sales to settle, and attach a live PNG screenshot with output.image. Also return region.',
  duplicate: 'Open TWO pages for the first artifact in ONE session. Set only one page\'s region signal to South. In a SECOND CLI script call resume both stable page IDs and return their regions. Do not use the URL to distinguish duplicate pages.',
  mutate: 'Open the first artifact, inspect mx.describe(), then invoke addTask exactly once with taskTitle="Held-out task". Do not set taskTitle. Return the receipt and the tasks/taskTitle signals.',
  subscribe: 'Open the first artifact. Subscribe to region in page.evaluate and record callback values in window.observed. Change the artifact region signal to South, wait for its callback, then unsubscribe. Return window.observed and leave it available for inspection.',
  invalid: 'Open the first artifact. Attempt exactly mx.set({region:"South",missing:2}), catch the error, and return its code plus the current region. Do not repair or retry the invalid patch: region must remain North.',
  failure: 'In the first CLI script call open the first artifact and then throw new Error("deliberate"). Inspect the receipt using sessions status. In a second script call resume the existing page and return region. Do not recreate the page.',
};
export const iframeTasks = {
  read: 'Render region and every sales row (name and revenue) in #rows initially and after parent changes. Render data as text, never HTML.',
  binding: 'Keep the #region select synchronized with the parent region signal. Selecting a region must set the parent region. Render the current region in #rows.',
  table: 'Render every title from the local table signal tasks in #rows, initially and after local mutations. Treat the table as read-only through mx.set.',
  mutate: 'Clicking #add must add the trimmed #label text through addTask without changing scalar taskTitle. Prevent double submissions, disable while pending, restore the button in finally, and show errors in #error.',
  invalid: 'Clicking #add must attempt mx.set({region:"South",missing:2}), catch the error, and display its code in #error. Do not repair the patch or change either signal separately.',
  unsubscribe: 'Subscribe to region and render it in #rows. Clicking #stop must unsubscribe; later parent changes must not change #rows.',
  describe: 'Call mx.describe() and render the names of all declared signals and mutations in #rows. Do not read private runtime internals or change any state.',
  states: 'Render sales rows in #rows. While sales is pending show Loading there. If sales errors, show its message in #error. Clear the error after a successful result. React to parent changes and render values safely.',
};
export const widgetShell = '<select id="region" aria-label="Region"><option>North</option><option>South</option><option>Broken</option></select><div id="rows"></div><input id="label" aria-label="Task title"/><button id="add">Add task</button><button id="stop">Stop updates</button><p id="error"></p>';
export function fixtureMarkup(code = '', includeWidget = true) {
  return '<Helmet><Value name="region" default="North"/><Value name="taskTitle" default="untouched"/><Value name="tasks" type="table" value={[{title:"Existing"}]}/><Query name="sales">{`select $region || \' total\' as name, case when $region=\'Broken\' then cast($region as integer) when $region=\'South\' then 230 else 110 end as revenue`}</Query><Mutation name="addTask">{`insert into tasks (title) values ($taskTitle)`}</Mutation></Helmet><h1>Live mx trial</h1><Select label="Host region" value="$region" options={["North","South","Broken"]}/>'+(includeWidget?'<Iframe title="Trial widget" height={260}>'+widgetShell+'<script>{'+JSON.stringify(code)+'}</script></Iframe>':'');
}
/** Grade observed state, not the agent's self-report. */
export function sessionVerdict(kind, e) {
  const rows = e.pages.flatMap(p => p.signals.tasks.value.rows);
  const noUnintendedWrites = rows.length >= e.pages.length && rows.length <= e.pages.length + (kind === 'mutate' ? 1 : 0)
    && e.pages.every(p => p.signals.taskTitle.value === 'untouched') && !e.sourceChanged
    && (!['invalid','failure','mutate'].includes(kind) || e.pages.every(p => p.signals.region.value === 'North'));
  // A failed, empty startup cannot break page continuity. Require the actual
  // final page IDs in multiple receipts; a recreated page is not a resume.
  const pageExecutions = e.executions.filter(x => x.pages?.length > 0);
  const resumed = pageExecutions.length >= 2 && new Set(pageExecutions.map(x => x.session_id)).size === 1
    && e.pages.every(p => pageExecutions.filter(x => x.pages.some(page => page.page_id === p.id)).length >= 2);
  const artifactIds = new Set(e.pages.map(p => artifactIdFromPath(new URL(p.url,'http://fixture').pathname)));
  const regions = e.pages.map(p => p.signals.region.value).sort();
  const results = JSON.stringify(e.executions.map(x => x.result));
  const conditions = {
    multi: resumed && e.pages.length === 2 && artifactIds.size === 2 && JSON.stringify(regions) === '["North","South"]',
    resume: resumed && e.pages.length === 1 && e.pages[0].marker === 'still-here' && regions[0] === 'South' && results.includes('still-here'),
    capture: resumed && regions[0] === 'South' && e.executions.some(x => x.attachments?.some(a => a.mime === 'image/png')),
    duplicate: resumed && e.pages.length === 2 && artifactIds.size === 1 && JSON.stringify(regions) === '["North","South"]',
    mutate: e.pages.length === 1 && rows.filter(r => r.title === 'Held-out task').length === 1 && results.includes('committed'),
    subscribe: e.pages.length === 1 && e.pages[0].observed?.some(value => (value && typeof value === 'object' ? value.value : value) === 'South') && e.subscriptionStopped,
    invalid: e.pages.length === 1 && regions[0] === 'North' && results.includes('NOT_WRITABLE'),
    failure: resumed && e.pages.length === 1 && regions[0] === 'North' && e.statusRead && e.executions.some(x => x.status === 'failed' && x.error?.message === 'deliberate'),
  };
  return { passed: noUnintendedWrites && conditions[kind] === true, noUnintendedWrites, behavior: conditions[kind] === true };
}
