# CLI completion assignments

The command table in cli-full-spec.md is the scope contract. Primary agent owns shared interfaces, behavioral test seeds, dispatch integration, review, cherry-picks, final validation and the single empty-body OSS PR. Implementers work in separate worktrees and do not delegate, merge, deploy or expand scope. No percentage estimates substitute for row-level evidence.

| Owner / model | Exclusive implementation scope | Acceptance |
| --- | --- | --- |
| Resources — gpt-6-astra, high | Account profile/token/connection/session domain services, typed YAML handlers, account collections, durable resource mutations and their handler tests. Finish profile recovery and mixed resource preparation. | Real-handler permission/CAS/atomicity tests; retry cannot duplicate effects; tokens stay out of YAML/journals/logs; omission preserves and explicit lists replace; all assigned resource rows mapped to evidence. |
| Commands — gpt-6-astra, high | New fork/export/preview modules and command tests; finish pull representation/stdout behavior and local/remote query edges in pull.ts, resource-pull.ts, local-document-query.ts, remote-query.ts and result-output.ts. | Local drafts never publish; private fork defaults; local preview/export with assets and data; source files survive conflicts; batch outcomes and output/type/format validation tested; no implicit network for offline operations. |
| Distribution — gpt-5.6-sol, medium | Installer/release assembly, homepage/llms/plugin install guidance, CLI README, skill installation/update packaging, plugin mirrors and packaging tests. | One verified standalone binary bootstrap; no npm-404 instructions, MCP or runtime remote skill dependency; checksum/install/update/skill placement tests; enumerate external publication still required. |
| Primary agent | contracts/utils shared schemas, commands.ts, arguments.ts, dispatch.ts, generic auth/recovery/workspace primitives, mixed-workspace orchestration, remaining collection/delete/comment wiring, generated teaching, final integration, harness evals and browser gates. | Every command-table row audited; no afbin api or legacy aliases; complete consistent help/errors/man/skills; full tests/build and affected browser flows; requested OpenCode GLM and pi DeepSeek evals; one reviewed feature branch. |

## Interface and ownership rules

- Existing parsed-command/workspace/client/result-envelope types remain the boundary. New handlers expose typed functions and receive these dependencies; they do not invent a second parser, authentication flow or transport.
- Domain writes enforce authorization and conditional state, and use the existing durable receipt mechanism. Account/profile work at 133620ff and its API/CLI tests are the initial resource seed; they are not proof of full account support.
- Primary owns shared contract changes. An implementer sends the required signature/schema before depending on it; primary supplies the common commit to affected worktrees.
- Implementers do not edit primary-owned files. Supply integration calls and command metadata requirements in the report; primary wires and generates teaching once integrated.
- Resources owns account-workspace.ts and resource domain modules; Commands owns pull/query/output modules listed above; Distribution does not edit the parser or generated teaching. Other overlapping files require explicit reassignment before editing.
- Read AGENTS.md and relevant design notes. Establish baseline tests, add behavioral failures for missing features, then implement a cohesive batch. Run targeted suites during work; only primary runs final full suites and browser gates.
- Before implementation handoff, primary seeds missing interface skeletons and core risk assertions and observes that the assertions detect the intended failure. Initial delegation may inspect scope/baseline and identify concrete seed requirements; it may not bypass this gate.
- Report changed files, command rows delivered, observed test commands/results, gaps and integration requirements. Commit in the isolated branch; primary reviews and reproduces checks before cherry-picking.

## Completion order

Run the three independent workstreams concurrently once seeded. Primary resolves contract requests and completes central orchestration concurrently. Integrate resource and command handlers before regenerating final teaching. Distribution bootstrap fixes can integrate earlier. Finish with one consolidated validation/fix cycle and an empty-body OSS PR; production pin and publishing follow OSS review/merge.
