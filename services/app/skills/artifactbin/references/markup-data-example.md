---
name: markup-data-example
description: >-
  A complete booking page, explained part by part: the data half, every $ value,
  the view half, set= versus run=, where queries run, and how to publish and test it.
---
## Read first

A page where people book half-hour slots and cancel their own. Copy it and
change the parts; the rules are in [data](markup-data.md).

## Worked example: a booking page

```jsx
<Helmet>
  <title>Book a time</title>
  <Import name="bookings" src="ref:BookRows1" />
  <Value name="day" type="date" />
  <Value name="note" type="string" url={false} />

  <Query name="days">{`
    select value as day, dayname(value) as dow, date_part('day', value) as num, date_format(value, '%b') as mon
    from json_each(date_series(date(to_timezone($_now, $_tz)), date_add(date(to_timezone($_now, $_tz)), 20, 'day')))
    where dayofweek(value) not in (0, 6)
  `}</Query>

  <Query name="picked">{`
    select coalesce($day, (select min(day) from days)) as day,
           date_format(coalesce($day, (select min(day) from days)), '%A, %d %B') as label
  `}</Query>

  <Query name="slots">{`
    with recursive half(n) as (select 0 union all select n + 1 from half where n < 17),
    grid as (
      select picked.day, printf('%02d:%s', 9 + n / 2, case when n % 2 = 0 then '00' else '30' end) as slot
      from picked, half
    )
    select grid.day || '_' || grid.slot as id, grid.day, grid.slot, b.booked_by, b.note,
           b.booked_by is not null and b.booked_by = $_me.id as is_mine,
           b.booked_by is null and grid.day || 'T' || grid.slot > to_timezone($_now, $_tz) as is_open
    from grid left join bookings.rows b on b.day = grid.day and b.slot = grid.slot
    order by grid.slot
  `}</Query>

  <Query name="mine">{`
    select id, day, slot, note from bookings.rows
    where booked_by = $_me.id and day >= date(to_timezone($_now, $_tz))
    order by day, slot
  `}</Query>

  <Mutation name="book" expectedAffected={1} reset="note">{`
    insert into bookings.rows (id, day, slot, booked_by, note, created_at)
    select $_row.id, $_row.day, $_row.slot, $_me.id, coalesce($note, ''), $_now
    where not exists (select 1 from bookings.rows where day = $_row.day and slot = $_row.slot)
  `}</Mutation>

  <Mutation name="cancel" expectedAffected={1}>{`
    delete from bookings.rows where id = $_row.id and booked_by = $_me.id
  `}</Mutation>
</Helmet>
<main data-design="tw" className="@container mx-auto max-w-3xl px-4 py-8">
  <h1 className="text-3xl font-semibold">Book a time</h1>

  <For each={$days} keyBy="day" className="mt-6 flex gap-2 overflow-x-auto">
    <Button set={{"day": "$_row.day"}} variant="outline">{$_row.dow} {$_row.num} {$_row.mon}</Button>
  </For>

  <For each={$picked} keyBy="day">
    <h2 className="mt-8 text-xl font-semibold">{$_row.label}</h2>
  </For>

  <Input label="Note for the booking" value="$note" />

  <For each={$slots} keyBy="id" className="mt-4 grid grid-cols-2 gap-2 @xl:grid-cols-3">
    {($_row.is_open) && (<Button run="$book">{$_row.slot}</Button>)}
    {($_row.is_mine) && (<Button run="$cancel" variant="outline">Cancel {$_row.slot}</Button>)}
  </For>

  <h2 className="mt-10 text-xl font-semibold">Your bookings</h2>
  <DataTable data="$mine" rowKey="id">
    <Column col="day" title="Day" />
    <Column col="slot" title="Time" />
    <Column col="note" title="Note" />
    <Column col="id" title="">
      <Button run="$cancel" variant="outline">Cancel</Button>
    </Column>
  </DataTable>
</main>
```

### The data half

`<Import name="bookings">` is the dataset, read in SQL as `bookings.rows`; put
your dataset's id in place of `BookRows1` (see Publish it).

```jsx
  <Value name="day" type="date" />
  <Value name="note" type="string" url={false} />
```

Two page values: `day`, the picked day (null at first), and `note`, a text box
kept out of the link.

Four queries, each a function of what it reads. `days` lists the next
weekdays from built-ins alone. `picked` reads `$day` and the `days` query
by name (`from days`), so no day picked means the first one. `slots` builds 18
half-hour slots for the picked day and joins them to the bookings. `mine` lists
the reader's own bookings from today on.

```sql
    from grid left join bookings.rows b on b.day = grid.day and b.slot = grid.slot
```

Two mutations, each an action. `book` inserts a row only while the slot is
free; `expectedAffected={1}` turns "nothing written" into a refusal the button
shows, and `reset="note"` empties the box once a booking commits.

```sql
    where not exists (select 1 from bookings.rows where day = $_row.day and slot = $_row.slot)
```

`cancel` deletes a row only when it is the reader's own:

```sql
    delete from bookings.rows where id = $_row.id and booked_by = $_me.id
```

### Every $ value, and where it comes from

| Written | What it is | Where it comes from |
|---|---|---|
| `$day` | a page value (`date`) | the day buttons' `set=`, or `?$day=2026-10-01` in the link |
| `$note` | a page value (`string`, not in the link) | the `<Input>` bound to it |
| `$days`, `$picked`, `$slots`, `$mine` | query results: rows | their `<Query>`, re-run when what they read changes |
| `$book`, `$cancel` | actions | a control's `run=` |
| `$_row.id`, `$_row.day`, `$_row.slot` | fields of one row | the `<For>` or `<Column>` the button sits in |
| `$_me.id` | the reader's account id; null for a guest | the platform |
| `$_now`, `$_tz` | the instant (UTC) and the reader's zone | the platform |

In `book`, `$note` is the one argument: a plain `$name` is that page value.
Names starting with `_` are built in and read-only.

### The view half

The body binds names and holds no SQL. `<For each={$days}>` repeats per row;
`{$_row.dow}` shows a field. The `<Input>` writes `$note` as the reader types.
`{($_row.is_open) && (…)}` shows a button only when the row says so. The
DataTable lists `$mine`, a Cancel button in a `<Column>`.

### set= versus run=

```jsx
    <Button set={{"day": "$_row.day"}} variant="outline">{$_row.dow} {$_row.num} {$_row.mon}</Button>
```

`set=` changes page values on click: instant, no SQL, nothing saved; queries
reading `$day` re-run.

```jsx
    {($_row.is_open) && (<Button run="$book">{$_row.slot}</Button>)}
```

`run=` runs a mutation, which writes the dataset. The row the button sits in
is its `$_row`; `$note` comes from the page. A guest's button stays disabled,
because `book` binds `$_me.id`.

### Where the queries run

You do not choose: in the reader's browser when the reader may hold the data it
reads, otherwise on the server, on the same SQLite and `$_now`. The rows are
the same.

## Publish it

The dataset declares its columns, so `booked_by` is a `user`. `bookings.jsx`:

```jsx
<Dataset kind="stored">
  <Table schema="public" name="rows" rows={[]} columns={[
    {"name":"id","type":"string"}, {"name":"day","type":"date"},
    {"name":"slot","type":"string"}, {"name":"booked_by","type":"user"},
    {"name":"note","type":"string"}, {"name":"created_at","type":"timestamp"}]} />
</Dataset>
```

`bookings.yaml` is `type: dataset`, `title: Bookings`, `source: bookings.jsx`.
Start `booking.jsx` with a fence, `---`, `visibility: unlisted`, `---`, so the
people you send the link to can open it. Then:

```sh
afbin push bookings.yaml --policy viewers-write --json
afbin push booking.jsx --json
```

`--policy viewers-write` goes on the push that CREATES the dataset: everyone
who can open the page may then write rows, and the page's SQL keeps each
booking its booker's. Put the returned id in `src="ref:…"` first.

## Test it as two people

`book.js` books a slot (give the second person another) and waits for it:

```js
const page = await context.newPage();
await page.goto('/a/<copy-id>');
await page.waitForFunction(() => Boolean(window.mx));
await page.getByRole('button', {name: '09:00', exact: true}).click();
await page.getByRole('button', {name: 'Cancel 09:00', exact: true}).waitFor();
return await page.evaluate(() => mx.read(['mine'], {wait: true}));
```

```sh
afbin testuser new --json          # twice: two people
afbin fork <page-id> --as <tu1> --json
afbin sessions script new --as <tu1> --input book.js --json
afbin sessions script new --as <tu2> --input book.js --json
```

Both book and cancel on the copy, never the other's booking. On the ORIGINAL,
`--as guest`, both actions stay disabled.
[Live sessions](live-sessions.md).
