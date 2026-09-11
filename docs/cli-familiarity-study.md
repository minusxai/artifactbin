# Planning command-selection study — 10 September 2026

For the final distinct-model, executable release acceptance, see
[cli-implementation-progress.md](cli-implementation-progress.md). This earlier study measured planning choices only.

This study used pi 0.77.0 and OpenCode 1.18.23 with the same Fireworks model,
`accounts/fireworks/models/deepseek-v4-flash-0731`, in fresh temporary working directories.
The user authorized the Fireworks credential source. Only that key was parsed from the supplied
env file and passed through the child environment; it was not placed in prompts, arguments or
provider configuration files. Saved output was redacted against the key before writing.

## What was measured

Tools were disabled/denied. Both harnesses received identical abbreviated proposed CLI help
and eight independent command-selection tasks. A second fresh run added clarified help while
keeping the tasks fixed. This is exploratory comprehension evidence, not skill-discovery,
executable CLI, recovery execution, clean-install or cross-model evidence. There is one sample
per harness/treatment and no gh-style control arm yet. Harness system prompts differ.

| Harness | Original help | Revised help |
| --- | --- | --- |
| pi | 18.61 s; 3096 reported tokens | 33.89 s; 5522 reported tokens |
| OpenCode | 40.56 s; 7200 reported tokens | 17.10 s; 5170 reported tokens |

Token accounting differs by harness (including reasoning). Custom provider metadata reported
zero cost without trustworthy price configuration; monetary cost is **unknown**, not free.
Timing is one observation, not a performance conclusion.

## Observations

- Both initially misunderstood `--harness repeatable`, claiming there was no exact subset
  selector. Revised `--harness <name>` grammar plus a two-harness example corrected this.
- Both initially suggested pulling during dirty-file conflict recovery without a complete
  viable procedure. Explicit backup, force-pull, manual merge preserving fresh sync fields,
  validate and conditional push produced the intended sequence in the revised runs.
- OpenCode's initial historical restore used an unresolved `<ref@2>` placeholder and claimed
  insufficient syntax. Both revised runs selected `pull report.jsx@2` then `push report.jsx`.
- Both consistently selected local status, explicit remote status, validate/fix then push,
  unattended update and combined comment reply/resolve.
- Both revised runs selected the intended command sequences for all eight scenarios on manual
  inspection. Pi added an unnecessary `--fix` during conflict validation; no overwrite of the
  other writer was proposed. Nothing was actually executed by either agent.
- Elicited ambiguity lists included issues already answered by the supplied help. Treat them
  as observations to inspect, not automatic reasons to add flags. Useful remaining clarifications
  include aggregate JSON output, status-vs-diff terminology and consistent harness/skill terms.

## Changes made to the artifact

The plan now specifies the harness argument and exact-set example; positional artifact ref vs
thread id; boolean `--resolve` requiring `--reply`; an explicit artifact-id escape for filename
collisions; and an actionable dirty-conflict diagnostic preserving both writers.

## Reproduction

```
python3 scripts/cli-familiarity-probe.py --env-file <authorized-env-file>
python3 scripts/cli-familiarity-probe.py --env-file <authorized-env-file> --revised
```

The script prints transcript locations and never prints the credential. Review assistant event
status, not process exit alone: pi returned exit 0 even when initial model aliases produced API
errors. Unversioned flash/pro aliases returned 404; the versioned model was selected after a
live models-list query. Those failed setup attempts are excluded from the completed study.

Next gate: real executable prototype in the repository's isolated eval harness with local skill
discovery, tool-call transcripts, injected failures and state assertions. Then repeat on release
binaries without MCP or runtime remote skill retrieval. This study does not close that gate.

## Executable follow-up

The tools-disabled study above is historical. The following trials executed a bundled markup CLI
prototype against the real disposable composed HTTP server, with locally discovered skills and
normal file/bash tools. `scripts/probes/executable-agents.py` reproduces them. Provider keys were
passed only in environment and redacted before saving transcripts. No MCP or remote skill was used.

Each fresh workspace had the same four tasks: repair prohibited inline style and publish a new
report; restore version 1 as a new head; preserve independent edits (base Alice/10, local Alice/20,
remote Bob/10 → Bob/20); end clean with a no-op push. The driver checked final server content and
version independently, then checked that local status/no-op push added no HTTP requests.

The gh-inspired comparison is a noun/action skin over the same implementation: `artifact create`,
`artifact edit`, `artifact view`, `artifact history`; local validate/status/diff stay the same. It is
not the actual GitHub gh binary. Both skins use equivalent local examples and recovery guidance.

| Harness | Model on Fireworks | Grammar | Checks passed | Seconds | Tool calls | HTTP calls | Writes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pi 0.77.0 | deepseek-v4-flash-0731 | proposed git-style | 4/4 | 45.21 | 14 | 15 | 3 |
| OpenCode 1.18.23 | deepseek-v4-flash-0731 | proposed git-style | 4/4 | 64.19 | 31 | 11 | 3 |
| pi 0.77.0 | deepseek-v4-flash-0731 | gh-inspired | 4/4 | 119.31 | 22 | 23 | 3 |
| OpenCode 1.18.23 | deepseek-v4-flash-0731 | gh-inspired | 4/4 | 88.39 | 31 | 20 | 3 |
| OpenCode 1.18.23 | glm-5p3-flash | proposed git-style | 4/4 | 53.48 | 24 | 15 | 3 |
| OpenCode 1.18.23 | glm-5p3-flash | gh-inspired | 4/4 | 49.77 | 23 | 13 | 3 |

Every listed leg discovered the local skill and called help once. The additional GLM legs were
requested by the user to test model diversity; the current preferred cross-model pair is pi with
DeepSeek and OpenCode with GLM. Full model IDs use `accounts/fireworks/models/`.

Recommendation: retain unified pull/push. Splitting create/edit adds a decision and showed no
completion benefit in these samples. This is a design judgment supported by a small smoke, not a
statistical claim of superior accuracy or speed. GLM was slightly faster on the alternate grammar;
latencies were not controlled for host load or provider variance. Custom-provider pricing metadata
was absent, so cost is unknown. Full release binaries, other formats/workflows, repeated seeds and
all harness integrations remain implementation regression gates.

### Observed mistakes and corrections

- Both agents initially used pulls to temporary files for inspection. The prototype incorrectly
  allowed two tracked files to name the same artifact, poisoning bare push. Enforcing the plan's
  duplicate-identity rule, providing remote diff, and showing same-path historical pull fixed this.
- A successful replacement response may omit markup when markup_changed=false. The prototype
  originally failed after the server committed, then retried a stale version. It now uses submitted
  canonical bytes in that response branch. This is an adapter defect, not a model failure.
- OpenCode once concatenated conflicting field values instead of reconciling independent edits.
  A concrete base/local/head example and a refusal rule for irreconcilable same-field edits now
  appear in help/recovery guidance. Final graded content verifies semantics, not a success message.
- GLM tried `pull --remote`, although --remote belongs to status/diff. The initial prototype ignored
  that unsupported flag; the final parser refuses it locally with unknown_option and an explanation.
  A deterministic test observed the wrong diagnostic before the guard and passed after it. A fresh
  GLM follow-up checks the stricter surface; do not erase this initial mistake from the results.
- Agents made unnecessary history/remote-status requests, including history for an untracked file.
  Untracked history now fails locally. Local-first transport guarantees do not automatically make
  agent workflows optimal; retain request-count scoring in the release gate.

### Excluded and interrupted attempts

Evaluator problems are kept separate from product/model outcomes. An inherited PWD caused OpenCode
sandbox startup refusal; an early grader failed before preserving its transcript. Later, shared
fixed /tmp backup names contaminated a restore trial. An overbroad sandbox metadata denial broke
Node path resolution; agents worked around it by copying the executable. These runs are not clean
evidence. The final sandbox permits required path metadata, denies unrelated temporary-file reads,
denies writes outside the workspace and protects checkout/credential directories. Temporary state,
PWD and harness configuration are isolated. Final listed runs used that corrected environment.
An early baseline was interrupted because its skill still named push; the listed baseline uses the
matching grammar throughout. Interrupted/prototype-defective runs were not relabeled as first-pass
success. No repeated retries are used to estimate a success rate.

Redacted transcript directories (local temporary evidence; not committed):
- proposed DeepSeek: `afbin-executable-results-hrmoljpa`
- matched gh-inspired DeepSeek: `afbin-executable-results-yjcsmsih`
- GLM proposed: `afbin-executable-results-bq8elho8`
- GLM gh-inspired: `afbin-executable-results-d4fdwfx2`

The fixture code is reviewable in this branch; raw model reasoning/streaming deltas are not evidence
for a tool-call count. Counts above use completed structured calls and the CLI's credential-free
request log. Server grading requests are outside those agent workflow counts.

The fresh GLM follow-up after strict per-command flag validation passed all four tasks in 40.19s
(exit 0). Transcript directory: `afbin-executable-results-zxc6tkfc`. This is a separate confirmation
run, not substituted into the earlier comparison table or used to estimate a success rate.
