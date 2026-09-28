/**
 * Parity-only fixtures for gate-compiled-parity: the shapes the production census found refused by
 * the compiler before w3-compiler-coverage — a registered wrapper with no Solid port (`Slide`,
 * `SlideDeck`, `Icon`, `Table`) holding an island, holding a `$` value, or sitting in a `<For>` row.
 * The kitchen sink's deck and table are static, so these are what prove the shells served around live
 * children match today's renderer. Kept apart from the page-speed set: the performance lab does not
 * view them.
 *
 * (`<Param>` and other unregistered legacy tags cannot be published any more; the unit tests in
 * services/app/lib/compiled-page/__tests__/compiler-coverage.test.ts cover them.)
 */

const ROWS = '[{"k":"a","n":1,"on":true},{"k":"b","n":2,"on":false},{"k":"c","n":3,"on":true}]';

/**
 * A deck whose slides read values and repeat rows (with icons). No slide holds a button: today's reader serves a
 * miniature's buttons inside the rail row's own button, the parser closes the row early, hydration fails (#418)
 * and React re-renders the rail on the client with client ids — the compiled page serves that final tree (a held
 * `<template>` the deck behaviour puts in place; unit-tested in compiler-coverage.test.ts and deck.test.ts), but
 * the rail's ids and inline style formatting are then React's client render's, which no server output can match.
 */
const DATA_DECK = `<Helmet><title>Parity data deck</title>
<Value name="who" type="string" default="Ada" />
<Value name="region" type="string" default="NA" />
<Value name="rows" type="table" value={${ROWS}} />
</Helmet>
<div data-design="tw" className="@container px-6 @2xl:px-12" id="dk0">
<SlideDeck id="dk1">
<Slide title="Cover" className="border-b border-border py-14" id="dk2"><h1 className="text-5xl font-bold" id="dk3">Hello {$who}</h1><p className="mt-4 text-muted-foreground" id="dk4">Region {$region}</p></Slide>
<Slide title="Rows" className="py-14" id="dk6"><ul className="mt-6" id="dk7"><For each={$rows} keyBy="k"><li className="flex gap-2" id="dk8"><Icon name="check" className="size-5" id="dk9" /><span id="dk10">{$_row.k} is {$_row.n}</span></li></For></ul></Slide>
<Slide title="Close" className="py-14" id="dk18"><h2 className="text-4xl font-semibold" id="dk19">Thanks, {$who}</h2></Slide>
</SlideDeck>
</div>`;

/** The kit Table family around repeated rows, a live control in a cell, and icons in rows. */
const DATA_TABLE = `<Helmet><title>Parity data table</title>
<Value name="rows" type="table" value={${ROWS}} />
<Value name="live" type="boolean" default={true} />
</Helmet>
<div data-design="tw" className="@container px-6 py-12 @2xl:px-12" id="tb0">
<Table className="mt-4" id="tb1"><TableCaption id="tb2">Rows from a table value</TableCaption>
<TableHeader id="tb3"><TableRow id="tb4"><TableHead id="tb5">Key</TableHead><TableHead id="tb6">Count</TableHead><TableHead id="tb7">Live</TableHead></TableRow></TableHeader>
<TableBody id="tb8"><For each={$rows} keyBy="k"><tr id="tb9"><td className="p-2" id="tb10">{$_row.k}</td><td className="p-2" id="tb11">{$_row.n}</td><td className="p-2" id="tb12">{$_row.on}</td></tr></For></TableBody>
<TableFooter id="tb13"><TableRow id="tb14"><TableCell id="tb15">Live</TableCell><TableCell colSpan={2} id="tb16"><Switch label="Live" checked="$live" id="tb17" /></TableCell></TableRow></TableFooter>
</Table>
<ul className="mt-8 grid gap-2" id="tb18"><For each={$rows} keyBy="k"><li className="flex items-center gap-2" id="tb19"><Icon name="circle-check" className="size-4 text-{$_row.k}" id="tb20" /><Badge variant="outline" id="tb21">{$_row.k}</Badge></li></For></ul>
</div>`;

/** `painted` names the DOM state that means the fixture's heaviest content is drawn (as the page-speed set does). */
export const COMPILED_PARITY_FIXTURES = [
  { key: 'data-deck', title: 'Parity data deck', template: 'deck', markup: DATA_DECK, painted: null },
  { key: 'data-table', title: 'Parity data table', template: null, markup: DATA_TABLE, painted: null },
];

/** Publish every parity fixture through `publish(body) → { id }`; returns the fixtures with their ids. */
export async function publishCompiledParityFixtures(publish, visibility = 'unlisted') {
  const published = [];
  for (const fixture of COMPILED_PARITY_FIXTURES) {
    const made = await publish({ title: fixture.title, markup: fixture.markup, visibility, ...(fixture.template ? { template: fixture.template } : {}) });
    published.push({ ...fixture, id: made.id });
  }
  return published;
}
