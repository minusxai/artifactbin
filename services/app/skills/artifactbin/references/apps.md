---
name: apps
description: Shared apps with dataset grants, accepted members, mentions and recipient checks.
order: 1
---
## Read first

New stored datasets allow public reads and mutations through their owner’s
artefacts by default. Publish the dataset, reference it in a page’s saved
`<Mutation>`, and invite people. Accepted members can run those actions; comments
and replies depend on sharing permissions, not membership. Existing version 1
policies keep their previous behaviour until explicitly upgraded. Explicit legacy
`--access` settings on creation retain version 1 behaviour; omit them for new grants.

Use real account IDs in `user` columns and `$_me.id` for the current user. Never
invent participant names or seed fake people. [User fields](databases-users.md)
explains column constraints.

## Build and invite

```sh
afbin push tasks.csv --type dataset --json
afbin push board.jsx --json
afbin invite <board-ref> @alex @sam --json
afbin members <board-ref> --json
```

People → Add people is the same UI operation. A recipient who follows the sender
joins immediately unless they disabled automatic acceptance in Account → People
& notifications. Mutual follows qualify; following the recipient yourself does
not. Otherwise the invitation stays pending, labelled Pending, until accepted.
For private artefacts, explicitly include viewing access with People → Include viewing access or `afbin invite <ref> @alex --include-access`. This requires sharing authority and saves access and invitation together. Without it, share first.

For artefacts with dataset mutations, Join sits beside the title; signed-out readers go through login. Pending/Joined opens People. Follow stays beside the author. Owners and editors join immediately; other readers request approval:

```sh
afbin join <board-ref> --json
afbin members <board-ref> approve <user-id> --json
afbin members <board-ref> accept --json
afbin members <board-ref> dismiss --json
afbin members <board-ref> leave --json
```

There is one relationship per person and artefact. Joining does not grant edit or
comment permission. Pending members cannot run persistent data actions. Filters,
local table controls and reads do not require joining. Each sender, including all
agents acting for them, has at most 30 outstanding pending invitations/requests.
Accepting, declining or withdrawing frees a slot for other people. A declined or withdrawn invitation cannot be resent to the same person, even from another artefact; they can request to join themselves. Explicit invitations can target non-followers. The narrower follower/member rule below applies to tagging, not explicit invitations.

## Show members

`_members` is the read-only table of accepted members of the current artefact.
It has `user_id` and `joined_at`; it never includes pending invitations. Do not
create a dataset table or a mutation to implement joining.

```jsx
<Helmet>
  <Query name="members">{`select user_id, joined_at from _members`}</Query>
</Helmet>
<DataTable data="$members" rowKey="user_id">
  <Column col="user_id"><User userId="$_row.user_id" /></Column>
  <Column col="joined_at" title="Joined" />
</DataTable>
```

## Mention someone

Type `@username` in a comment and select the person. In the document editor,
select the text, choose Mention person, then select the username. Saving the
document or posting the comment sends the notification. Typing alone does not.

Agents select the same eligible recipients:

```sh
afbin mention <board-ref> @alex --json
```

This returns stable-ID `markdown` for a comment and `markup` for a document. Put
the returned fragment in the comment/document, then post/push it. Resolution
itself sends nothing. Autocomplete and the server allow only recipients who
follow the sender or already belong to that artefact, excluding blocks.

A new mention invites a non-member; an accepted member gets a normal mention.
Repeated saves do not notify again, and further tags while pending reuse the
invitation. Rendering `<User>`, importing IDs, and forking never send mentions.
An agent uses the human’s eligibility, preferences and 30-request limit.

## Dataset rules

The new default policy is:

```json
{"version":2,"allow":[
  {"actions":["read"],"from":{"user":"*"}},
  {"actions":["insert","update","delete"],"from":{"artifactOwner":"$owner"}}
]}
```

`from.user` matches the acting user; `from.artifact` matches a saved artefact ID;
`from.artifactOwner` matches its owner. Use a stable ID, `*`, or `$owner` (the
dataset owner; not valid for `artifact`). Multiple selectors in one rule all
have to match. Any matching rule grants its actions. The artefact context is
server-derived, never a caller-supplied impersonation flag.

Examples: `{"user":"$owner"}` allows the owner directly;
`{"user":"usr_alex"}` allows Alex; `{"artifact":"abc123"}` allows one
artefact; `{"artifact":"*"}` allows all artefacts. Artefact mutations still
require accepted membership. `allow: []` locks reads and writes; administration
remains available to owners/editors. Private sharing remains an audience ceiling
for reads. Grant changes are revision-checked and apply at mutation commit.

Pull a dataset’s settings to edit its policy:
`afbin pull <id> --type dataset --output tasks.yaml`. Optional `tables` restrictions
use the existing column/filter/check grammar and further restrict grants.
Omitting `tables` leaves granted writes unrestricted; `tables: []` denies writes.
Connected Postgres datasets remain read-only.

## Fork and verify

Forks copy stored datasets they write, including the owner’s own datasets, and
remap references and artefact-specific grants. Public read-only references stay
shared. Restricted dependencies are copied only when the forker can read them.
No memberships or notifications are copied; the new owner starts as a member.

Verify shared behaviour on a disposable test-user fork with `afbin testuser`,
`afbin fork --as` and `afbin sessions`; see [live sessions](live-sessions.md).
Check the owner, a pending recipient, an accepted member, and a member after
leaving. A successful publish checks syntax and query shapes, not live actions.


```sh
afbin testuser new --json
afbin fork abc123 --as tu_example --json
afbin sessions script new --as tu_example --input member.js --json
afbin sessions script new --input owner.js --json # you, on the same copy
afbin testuser delete tu_example --json
```

A test user verifies a COPY, never that `abc123` works; nothing a test user does reaches
the original. An action outside its sandbox returns `sandbox_only`.
Run each write on the test-user fork. On the original,
`$_me.id` writes must stay disabled and change no data when checked as a guest.
A Mutation may read other imports and `_members`
(`where exists (select 1 from _members where user_id = $_me.id)`), never a
query: pass a query's value in as an argument.
