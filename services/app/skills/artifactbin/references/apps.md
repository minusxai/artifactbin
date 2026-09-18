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
  <Table schema="public" name="people" rows={[]}
    columns={[{"name":"person","type":"user","constraints":{"self":true}},
              {"name":"joined_on","type":"date"}]} />
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

```jsx
<Helmet>
  <Value name="item" type="string" url={false} />
  <Value name="amount" type="number" url={false} />
  <Value name="spent_on" type="date" url={false} />
  <Query name="balances" source="ref:tab123">{`
    select p.person,
           coalesce(sum(e.amount), 0)
             - (select coalesce(sum(amount), 0) from public.expenses)
               / (select count(*) from public.people) as net
    from public.people p left join public.expenses e on e.paid_by = p.person
    group by p.person order by net desc
  `}</Query>
  <Query name="tab" source="ref:tab123">{`
    select id, spent_on, item, amount, paid_by from public.expenses
    order by spent_on desc
  `}</Query>
  <Query name="to_join" source="ref:tab123">{`
    select $_me as person where $_me is not null
      and not exists (select 1 from public.people where person = $_me)
  `}</Query>
  <Mutation name="join" source="ref:tab123">{`
    insert into public.people (person, joined_on)
    select $_me, current_date
    where $_row.person = $_me
      and not exists (select 1 from public.people where person = $_me)
  `}</Mutation>
  <Mutation name="add" source="ref:tab123" reset="item amount spent_on">{`
    insert into public.expenses (id, paid_by, spent_on, item, amount)
    select uuid(), $_me, coalesce($spent_on, current_date), $item, $amount
  `}</Mutation>
</Helmet>
<main className="mx-auto max-w-2xl space-y-6 p-8">
  <h1>Trip tab</h1>
  {$_me ? <p>You are <User id="$_me" avatar />.</p>
        : <SignIn>Sign in to join this tab</SignIn>}
  <For each={$to_join} keyBy="person"><Button run="$join">Join this tab</Button></For>
  <DataTable data="$balances" rowKey="person">
    <Column col="person" title="Person"><User id="$_row.person" /></Column>
    <Column col="net" title="Net" fmt="$,.2f" align="right" />
  </DataTable>
  {$_me ? <Card><CardContent className="space-y-3">
      <Input label="What it was for" value="$item" />
      <Input label="Amount" type="number" min={0} value="$amount" />
      <DatePicker label="Spent on" value="$spent_on" />
      <Button run="$add">Add expense</Button>
    </CardContent></Card>
        : <SignIn className="w-full">Sign in to add an expense</SignIn>}
  <DataTable data="$tab" rowKey="id">
    <Column col="spent_on" title="Date" />
    <Column col="item" title="Item" />
    <Column col="amount" title="Amount" fmt="$,.2f" align="right" />
    <Column col="paid_by" title="Paid by"><User id="$_row.paid_by" /></Column>
  </DataTable>
</main>
```

Line by line, this is the whole pattern:

- **Membership decides the UI.** The `to_join` Query returns ONE row — the
  viewer — only for a signed-in person who has not joined (`$_me is not null`
  first, or a guest gets a row with no key), and `<For>` over an empty result
  renders nothing, so the button is there for a newcomer and gone for everyone
  else. A `<Button run>` inside a `<For>` is a ROW action, so the Mutation reads
  `$_row`; it still WRITES `$_me`, never the row — a row snapshot comes from the
  browser, and `where $_row.person = $_me` is how the click is tied to the row it
  came from. That is also what makes a guest's press answer `sign_in_required`
  instead of a refusal about the data. `where not exists` keeps it idempotent.
- **The form is kit controls**, one visual family: `<Input>` (with
  `type="number"` where it is a number), `<Textarea>`, `<DatePicker>`,
  `<Button>`. A native `<input value="$item">` still binds — and is themed now —
  but the kit is what matches the rest of the page.
- **Every row records its author** with `$_me`, and is READ back with
  `<User id="$_row.paid_by" />` — the display name of an account, resolved for
  whoever is looking.
- **The form's scalars are `url={false}`** so a half-typed amount never travels
  in the link the next person opens, and `reset="item amount spent_on"` clears
  them on success only.
- **`{$_me ? … : <SignIn>…</SignIn>}`** gives a guest the door instead of a
  button that refuses. `<SignIn>` returns to this page, so they land back where
  they were.
- **Balances are computed in SQL**, never typed. The page holds no arithmetic.

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
A join needs two people; the second is a TEST USER: a throwaway person your
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

Run each write as yourself and once `--as guest`
([live sessions](live-sessions.md)): the guest must be offered a sign-in, not an
error. Fix and push until every pass is clean.
