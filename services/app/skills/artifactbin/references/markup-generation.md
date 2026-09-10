---
name: markup-generation
description: Model-backed mutations.
---

## Read first

`llm(modelAlias, prompt, schemaJson, optionsJson?)` returns a JSON **string** inside a stored
dataset Mutation. The operator must configure the alias. Credentials and model
endpoints never belong in markup. Ordinary Queries cannot call it. Local table
mutations do not generate; use a writable stored dataset and dataset edit access.

## Contents

Example · Conditional calls · Schema and execution guarantees · Operator setup.

## Example

```jsx
<Helmet>
  <Value name="move" default="Take the train" />
  <Query name="nodes" source="abc123">{`select * from public.nodes`}</Query>
  <Mutation name="step" source="abc123">{`
    insert into public.nodes (result)
    select llm('default', $move,
      '{"type":"object","properties":{"title":{"type":"string"},"score":{"type":"number","minimum":0,"maximum":10}},"required":["title","score"],"additionalProperties":false}')
  `}</Mutation>
</Helmet>
<input aria-label="Next move" value="$move" />
<Button run="$step">Do it</Button>
<DataTable data="$nodes" />
```

Replace `abc123` with a real writable dataset containing a `public.nodes` table
and string `result` column. From a managed Iframe, the same operation is
`await mx.mutate('step', {move: 'Take the train'})`. It resolves after persistence;
dependent queries refresh normally. Authorize the viewer to edit the dataset.
Public read access does not grant generation or write access.

## Conditional calls

Materialize a generated result before reusing it. DuckDB decides which branch
needs a model call; the app resolves the request, validates JSON, and resumes SQL.
For a single-column legacy dataset, a narrator/judge mutation can use:

```sql
insert into ref_abc123
with narration as materialized (
  select llm('default', $prompt, $schema, '{"temperature":0.9}') as result
)
select case
  when (result::json->>'score')::double > 8
    or (result::json->>'score')::double < 2
    or $last_move
  then llm('default', 'Judge this story: ' || $prompt || result, $schema, '{"temperature":0.3}')
  else result
end
from narration
```

Declare `prompt`, `schema`, and boolean `last_move` Values before using them.
Use additional projections to retain narration fields while taking the final
score/verdict from the judge. The example replaces the whole result for brevity.
Mutations see only their target table and bound scalars, not other Queries or
datasets. A self-query of a legacy `ref_<id>` target can assemble branch history
with recursive SQL; order the trace explicitly when building a prompt.

## Schema and execution guarantees

The supported JSON Schema subset has `type`: object, array, string, number,
integer, boolean or null; `description` and scalar `enum`; numeric
`minimum`/`maximum`; string `minLength`/`maxLength`; array `items`,
`minItems`/`maxItems`; object `properties`, `required`, and
`additionalProperties:false`. Objects must declare all three object keywords.
Schema nesting is limited to eight levels. References, unions, formats and
unknown keywords are refused. Validation does not coerce model output.

- Publish-time SQL checks use a NULL VARCHAR stub and make **zero model calls**.
  Model aliases, dynamic schemas and runtime output are checked at invocation.
- Up to four distinct calls per mutation and 180 seconds of wall time from the
  first generation, including subsequent SQL work. Prompts are bounded to 64 KB,
  schemas to 8 KB, and generated JSON to 64 KB. Each app process admits at most
  four simultaneous provider requests.
- Identical alias/prompt/schema/normalized-options arguments reuse one validated result throughout
  the server invocation, including dataset compare-and-swap retries. Supply stable
  IDs as signals; avoid random/time-dependent generation arguments.
- Failed/invalid/timed-out generation does not save partial dataset rows. A model
  call can still incur cost before a later SQL error or failed persistence.
- A separate browser request or process restart starts a new invocation. This is
  not durable job storage or exactly-once provider billing. Do not retry a timed-out
  write blindly; first check the saved rows using an author-supplied operation ID.

## Operator setup

Set `GENERATION__MODELS_FILE` to a JSON file path (relative paths resolve from the
app process working directory). Copy `generation.models.example.json`:

```json
{"default":{"api":"openai-completions","baseUrl":"https://api.fireworks.ai/inference/v1","model":"your-model-id","apiKeyEnv":"GENERATION__FIREWORKS_API_KEY"}}
```

Set the referenced namespaced environment variable separately. The file contains
connections, not prompts, roles, sampling settings or inline secrets. Narrator and
judge calls can use the same `default` connection with different prompts/options.
Missing files, invalid config and unset referenced keys fail startup.

The optional fourth argument is JSON containing `temperature` (0–2) and/or
`maxTokens` (integer 1–16384). Defaults are 0.7 and 4096. Options are limited to 1 KB;
unknown fields, endpoints and credentials are rejected. Equivalent option objects
share a result within an invocation; different sampling settings do not.

Supported APIs: `openai-completions`, `openai-responses`, `anthropic-messages`,
`google-generative-ai`. The Pi model library handles provider transport; output
is always validated by artifactbin. Provider-enforced JSON sampling is not
required or promised. No automatic retry or agent/tool loop is run.

Leave the setting empty to disable generation. Aliases use operator credentials
for authorized dataset editors; configure only accounts/models you intend to
make available to those editors. In a split deployment, set the proxy's
`UPSTREAM__DEADLINE_MS=200000` and align any external ingress timeout with it.

The deterministic browser check is
`npm run build && npm run test:gates -- --only=generation-mutations --servers=1`.
It uses a disposable provider fixture, never production model credentials.
