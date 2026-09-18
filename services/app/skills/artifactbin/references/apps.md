---
name: apps
description: >-
  An app several people use: account-backed rows, joining by link, a guest door and writes that are tested before handover.
order: 1
---
## Read first

"Shared with my friends", "one row per person", "who paid", "RSVP", "vote" — the
request is an APP, not a document. Its shape is fixed: an EMPTY stored dataset
with `user` columns, a page that writes to it, and every person carried as their
ACCOUNT. Never a typed name, never a seeded person, never a "Me" row.

[User fields](databases-users.md) is the grammar; this is one whole app, once.

## Contents

The dataset · The page · Three mistakes · Verifying with test users.

## The dataset: declared columns, no rows

A sheet the people using the page fill in later publishes EMPTY. Save the
definition as `tab.jsx` — it is not your page:

```jsx
<Dataset kind="stored">
  <Table schema="public" name="members" rows={[]}
    columns={[{"name":"person","type":"user","constraints":{"self":true}}]} />
  <Table schema="public" name="expenses" rows={[]}
    columns={[{"name":"id","type":"string"},
              {"name":"paid_by","type":"user","constraints":{"self":true}},
              {"name":"spent_on","type":"date"},
              {"name":"item","type":"string"},
              {"name":"amount","type":"number"}]} />
</Dataset>
```

`self: true` on the column that records WHO did it: the server refuses any other
account there, so a row cannot be filed under someone else. Save `tab.yaml`
beside it:

```yaml
type: dataset
title: Trip tab
source: tab.jsx
access: readwrite
```

```sh
afbin push tab.yaml --policy viewers-write --yes --json
```

`--policy viewers-write` is the difference between "my friends can read it" and
"my friends can use it": without it only people you shared it with as editors
write. Use the returned dataset id in place of `tab123` below.

## The page

Joining is an ordinary app action: a Button inserts `$_me` into `public.members`.
The table name and button label are yours. The owner joins the same way as anyone
else. Likes are social feedback and do not change these rows or grant access.

```jsx
<Helmet>
  <Value name="person" type="user" url={false} />
  <Value name="item" type="string" url={false} />
  <Value name="amount" type="number" url={false} />
  <Value name="spent_on" type="date" url={false} />
  <Query name="members" source="ref:tab123">{`
    select person from public.members order by person
  `}</Query>
  <Mutation name="join" source="ref:tab123">{`
    insert into public.members (person) select $_me
    where not exists (select 1 from public.members where person = $_me)
  `}</Mutation>
  <Query name="tab" source="ref:tab123">{`
    select id, spent_on, item, amount, paid_by from public.expenses
    order by spent_on desc
  `}</Query>
  <Query name="balances">{`
    select p.person, coalesce(sum(e.amount), 0)
      - (select coalesce(sum(amount), 0) from tab)
        / nullif((select count(*) from members), 0) as net
    from members p left join tab e on e.paid_by = p.person
    where $person is null or p.person = $person
    group by p.person order by net desc
  `}</Query>
  <Query name="participant">{`
    select person from members where person = $_me
  `}</Query>
  <Mutation name="add" source="ref:tab123" reset="item amount spent_on" expectedAffected={1}>{`
    insert into public.expenses (id, paid_by, spent_on, item, amount)
    select uuid(), $_me, coalesce($spent_on, current_date), $item, $amount
    where $_row.person = $_me and length(trim($item)) > 0 and $amount > 0
  `}</Mutation>
</Helmet>
<main className="mx-auto max-w-2xl space-y-6 p-8">
  <h1>Trip tab</h1>
  {$_me ? <p>You are <User userId="$_me" />. Join this tab to take part.</p>
        : <SignIn>Sign in to join this tab</SignIn>}
  {$_me ? <Button run="$join">Join tab</Button> : null}
  <Select label="Person filter" value="$person" options="$members" placeholder="Everyone" />
  <DataTable data="$balances" rowKey="person">
    <Column col="person" title="Person"><User userId="$_row.person" /></Column>
    <Column col="net" title="Net" fmt="$,.2f" align="right" />
  </DataTable>
  {$_me ? <Card><CardContent className="space-y-3 p-4">
      <Input value="$item" label="What was it?" />
      <Input value="$amount" type="number" label="Amount" />
      <DatePicker value="$spent_on" label="Spent on (blank = today UTC)" />
      <For each={$participant} keyBy="person"><Button run="$add">Add expense</Button></For>
    </CardContent></Card> : null}
  <DataTable data="$tab" />
</main>
```

The Join insert reads its own table to prevent duplicate rows, including repeat
clicks. `members` drives the balances, participant action, and dropdown options.
An explicit `options="$members"` supplies the user IDs; their visible names come
from the people already returned with the query. Joining grants no platform
permissions: the dataset's write policy still decides who can write.

The expense button appears for a row of `participant`. This is app UI, not an
access rule: the server checks the row shape and enforces `self` and the dataset
policy. Its SQL also rejects empty descriptions and nonpositive
amounts. `expectedAffected={1}` makes a rejected insert an error, not a silent
success. Input placeholders are hints, never submitted values. Here an unset
date means today (UTC), as the label explains; choosing a date overrides it.

`$_me` is the signed-in account, or null. A mutation using it automatically
offers Sign in to a guest; server checks still refuse a direct guest write.
`<User userId="…" />` can display known people from the rows returned to the reader. `id` always names the source node, never a person.

## Three mistakes to skip

1. **Typed names.** A `person` column of strings, or a `<Select>` of names you
   invented, cannot tell two Alices apart, cannot say who is reading, and
   refuses nobody. Use `type="user"` and `$_me`.
2. **Seed rows.** A row invented to make the table look alive is a fake person
   in a real list — and an empty stored `<Table>` with declared `columns` is
   accepted, so there is nothing to work around.
3. **A flag left in the link.** A draft or scratch `<Value>` without
   `url={false}` is copied into the URL a reader shares, and arrives as somebody
   else's half-finished input.

## Verifying with test users

A push proves the markup and the read queries; it proves NOTHING about a button.
An app needs two people; the second is a TEST USER: a throwaway person your
account mints (three at a time, gone in a day) and erases whole.

```sh
afbin testuser new --json                    # id, label, expiry
afbin fork abc123 --as tu_9fA2b --json       # the copy is that person's
afbin sessions script new --as tu_9fA2b --input join.js --json
afbin sessions script new --input check.js --json   # you, same copy
afbin testuser delete tu_9fA2b --json        # erases it and all it made
```

Forking copies the datasets the page WRITES under the new owner — rows, columns,
access and write policy — and repoints the page at those copies; datasets it
only reads keep their `ref:`, because copying a live source would freeze it.

**The realism gap.** A test user verifies a COPY of your artifact. A clean pass
proves that an artifact with this markup and these dataset policies works for
two people — never that `abc123` works — and nothing a test user does reaches
the original, its datasets or any account's rows. Fix the source, push, fork
again.

**What a test user cannot do.** On an artifact an account owns it is exactly a
guest: it reads what the link grants and nothing else — no `$_me` write, like,
follow, comment or fork. That refusal is `sandbox_only`, and the answer is never
to press Join again on the real page: fork it to the test user and use the copy.

Run each write on the test-user fork, once as its test user and once as yourself.
On the original page, check each action `--as guest` ([live sessions](live-sessions.md)):
$_me writes must offer Sign in and change no data. Check other actions against their intended permissions.
Do not run successful test writes on the original page. Fix, push and fork again until every pass is clean.

A Mutation can read only the stored table it writes; a second stored table is not available.
Put cross-table reads in Queries and bind their results to the action.
