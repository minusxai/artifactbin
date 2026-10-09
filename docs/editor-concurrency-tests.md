# Editing regression matrix

These tests exercise the real source replacement, persistence conflict kernel, editor history,
runtime protocol, and mounted ProseMirror editor. They do not mock the behavior under test.
Run the fast matrix from the repository root:

```sh
npm test -- --files services/app/lib/editor-v2/__tests__/source-edit.test.ts services/app/lib/editor-v2/__tests__/history.test.ts services/app/solid/editor/__tests__/create-editor-source.test.ts services/app/solid/editor/__tests__/create-in-place-edit.test.ts services/app/solid/editor/__tests__/flow-editor.test.tsx services/app/lib/document/__tests__/edit-batch.test.ts services/app/lib/document/__tests__/splice.test.ts
```

| Boundary | Cases | Required behavior |
| --- | --- | --- |
| Prose transaction | Local typing, heading, bold, list, split versus remote neighbor typing, in both commit orders | Same final source; both changes survive |
| Prose transaction | Whole-region submission versus inserted child | Preserve the remote child while applying the disjoint local change |
| Prose transaction | Same-text conflict, deleted target, replaced container | Refuse the whole edit; leave the remote document unchanged |
| Prose transaction | Target moved, neighbor inserted/deleted, dataset changed | Resolve the unique unchanged prose region; preserve surrounding source bytes |
| Prose transaction | Duplicate target, old JSX surviving only in comment/string | Refuse rather than edit an ambiguous or non-prose occurrence |
| Validation | Invalid JSX, scripts, live controls, bound checkbox, saved checkbox | Fail atomically; allow only validated prose |
| History | Heading, bold, italic, list, quote, code and paragraph split followed by remote neighbor edit/insertion | Undo/redo only the local change; preserve remote changes |
| History | Conflicting remote edit/deletion; pending commit failure | Refuse without changing source or consuming the undo entry |
| History | Typing groups and delayed publish versus remote replacement | Group local typing; never resurrect stale source after a remote update |
| Runtime | Full-region Markdown conversion versus remote prose | Apply once, retain readiness and allow acknowledged navigation commit |
| Runtime | Rejected edit, later queued edits, navigation flush/ack race | Preserve the first draft, pause editing and block navigation until recovery |
| Runtime | Missing nonce, commit timeout, simultaneous commits, pending image insertion | Reject forged events; require acknowledgement; avoid duplicate flushes |
| Mounted selection | Remote insertion/deletion above, movement, heading conversion above or at active block | Preserve block ID, offsets and backward selection without focusing |
| Markdown input | Bold/italic, headings 1–6, bullet/ordered lists, quote, checklist, rule, code | Preserve identity, valid serialization, caret and undo/redo |
| Markdown input | Following plain text, empty/escaped markers, mid-prose prefixes, code/list/table contexts | Apply only supported shortcuts; leave literal content literal |
| Markdown input | IME composition, paste, list continuation/exit, repeated Enter, save/reload | No unintended conversion or data loss; keep a place to type |
| Persistence | Atomic multi-splice edit, unrelated concurrent changes, conflicting moved node | Rebase disjoint changes; never return a partial conflicting batch |

Finite regression cases cannot prove every possible interaction. Live transport interruption,
two independent browser sessions, native IME behavior, clipboard permissions, focus painting and
mobile keyboards additionally need browser/integration checks. New incidents should become
minimal deterministic cases here before their fixes are considered complete.

Known conservative boundary: root identity must still resolve uniquely. A stale sibling range
whose roots were deleted, duplicated or reordered is rejected for draft recovery rather than
guessed. This is not a claim that the historical Launch Oct 7 incident's exact trigger is proven.
