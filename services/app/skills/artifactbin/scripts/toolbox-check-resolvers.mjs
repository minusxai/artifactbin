/**
 * Internal: what check.mjs makes of the page's failed GraphQL fields after a hosted run (captured
 * in the browser by toolbox-check-graphql.mjs). A guest's failure carries no owner detail: it takes
 * the detail the same field showed the owner in another viewport, or its read-only query is asked
 * again as the owner; a write is never re-run. A field the server refused only because a resolver
 * secret has no value yet (its exact refusal, secret_unavailable or connection_unavailable, naming
 * a declared secret the owner has not set) is not a failure: when every failed field of a viewport
 * is such a refusal, its unfinished step and the page and console errors logged after the first
 * refusal become a Not tested item. Secret values never reach the check; tokens are never printed.
 * Used by: toolbox-check-command.mjs.
 */

/** The owner detail of an unset secret (lib/page-operations public-fetch.ts and database.ts;
 * backend.ts prefixes an upstream HTTP status the resolver saw first). */
const UNSET = /^(?:HTTP \d{3}: )?(?:secret_unavailable|connection_unavailable): (\S+)$/;
const named = failure => UNSET.exec(failure.detail ?? failure.ownerDetail ?? '')?.[1];
const unique = values => [...new Set(values)];

/** Fills the owner detail and excuses unset secrets on the checks in place; returns the result's
 * graphqlFailures and needsSecrets, each only when present. Never throws. */
export async function explainGraphql(client, id, checks, guestRun = false) {
  const failures = checks.flatMap(check => check?.graphqlErrors ?? []);
  if (!failures.length) return {};
  const shown = new Map(failures.filter(f => f.detail).map(f => [f.field, f.detail]));
  for (const check of checks)
    for (const failure of check?.graphqlErrors ?? []) {
      const {replay} = failure;
      delete failure.replay;
      if (failure.detail || !(guestRun || check.viewer === 'guest')) continue;
      failure.guest = true;
      if (shown.has(failure.field)) failure.ownerDetail = shown.get(failure.field);
      else if (replay) Object.assign(failure, await asOwner(client, id, replay, failure.field));
      else failure.notReplayed = true;
    }
  // Which declared secrets have no value: the owner's Resolvers settings, read only when needed.
  let unset = [];
  if (failures.some(named)) {
    const read = await client.request(`/api/my/artifacts/${id}/resolvers`).catch(() => null);
    unset = (Array.isArray(read?.resolvers) ? read.resolvers : []).flatMap(resolver =>
      Object.keys(resolver?.secrets ?? {}).filter(name => !resolver.set?.includes(name)));
  }
  for (const failure of failures)
    if (unset.includes(named(failure))) failure.needsSecret = named(failure);
  const needsSecrets = new Map();
  for (const check of checks) {
    const errors = check?.graphqlErrors ?? [];
    if (!errors.length || !errors.every(failure => failure.needsSecret)) continue;
    const item = {
      ...(check.error ? {step: check.failedStep ?? null} : {}),
      fields: unique(errors.map(failure => failure.field)),
      secrets: unique(errors.map(failure => failure.needsSecret))
    };
    check.needsSecret = {...item, ...(check.error ? {error: check.error} : {})};
    delete check.error;
    // What the page logged from the first refusal on came from it; what came before still counts.
    const first = key => Math.min(...errors.map(failure => failure[key + 'Before'] ?? Infinity));
    check.pageErrors = (check.pageErrors ?? []).slice(0, first('pageErrors'));
    check.consoleErrors = (check.consoleErrors ?? []).slice(0, first('consoleErrors'));
    needsSecrets.set(JSON.stringify(item), item);
  }
  const failed = new Map();
  for (const failure of failures.filter(failure => !failure.needsSecret)) {
    const {field, message, code, detail, guest, ownerDetail, ownerPasses, notReplayed} = failure;
    const shape = {field, message, code, detail, guest, ownerDetail, ownerPasses, notReplayed};
    failed.set(JSON.stringify(shape), JSON.parse(JSON.stringify(shape)));
  }
  return {
    ...(failed.size ? {graphqlFailures: [...failed.values()].slice(0, 8)} : {}),
    ...(needsSecrets.size ? {needsSecrets: [...needsSecrets.values()]} : {})
  };
}

/** The same read-only query as the owner: the detail of the same field, or that it succeeds. */
async function asOwner(client, id, replay, field) {
  try {
    const body = await client.request(`/api/artifacts/${id}/graphql`,
      {method: 'POST', body: replay, safeToRepeat: true, timeoutMs: 8000});
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    if (!errors.length) return {ownerPasses: true};
    const same = errors.find(error => error?.path?.join?.('.') === field) ?? errors[0];
    const detail = same?.extensions?.detail;
    return typeof detail === 'string' ? {ownerDetail: detail.slice(0, 200)} : {};
  } catch {
    return {};
  }
}
