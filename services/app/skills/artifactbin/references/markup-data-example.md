---
name: markup-data-example
description: >-
  A complete booking page with every $ value it reads, and how to publish it
  and test it as two people.
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

Every `$` value, and where it comes from:

| Written | What it is | Where it comes from |
|---|---|---|
| `$day` | a page value (`date`) | the day buttons' `set=`, or `?$day=2026-10-01` in the link |
| `$note` | a page value (`string`, not in the link) | the `<Input>` bound to it |
| `$days`, `$picked`, `$slots`, `$mine` | query results: rows | their `<Query>`, re-run when what they read changes |
| `$book`, `$cancel` | actions | a control's `run=` |
| `$_row.id`, `$_row.day`, `$_row.slot` | fields of one row | the `<For>` or `<Column>` the button sits in |
| `$_me.id` | the reader's account id; null for a guest | the platform |
| `$_now`, `$_tz` | the instant (UTC) and the reader's zone | the platform |

A plain `$name` in SQL is that page value; names starting with `_` are built
in and read-only. `set=` changes page values on click (no SQL, nothing saved);
`run=` runs a mutation against the dataset with the button's row as `$_row`.
A guest's `book` button stays disabled because `book` binds `$_me.id`.
`expectedAffected={1}` turns "nothing written" into a refusal the button
shows. Queries run in the reader's browser when the reader may hold the data,
otherwise on the server; the rows are the same.

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

`book.js` books a slot (a different one per person); run it as two test users
on a copy, one session at a time ([apps](apps.md)):

```js
const page = await context.newPage();
await page.goto('/a/<copy-id>');
await page.waitForFunction(() => Boolean(window.page));
await page.getByRole('button', {name: '09:00', exact: true}).click();
await page.getByRole('button', {name: 'Cancel 09:00', exact: true}).waitFor();
return await page.evaluate(() => window.page.ready('mine'));
```

```sh
afbin testuser new --json  # twice
afbin fork <page-id> --as <tu1> --json
afbin sessions script new --as <tu1> --input book.js --json
afbin sessions close <session-id> --json
afbin sessions script new --as <tu2> --input book.js --json
```

Each books and cancels only their own slot; `--as guest` on the original
finds both buttons disabled. [Live sessions](live-sessions.md).
