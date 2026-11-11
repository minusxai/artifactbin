/**
 * Internal: what check.mjs makes of the page's failed calls after a hosted run (its sql, captured
 * in the browser by toolbox-check-calls.mjs). A guest's failure carries no owner detail: it takes
 * the detail the same call showed the owner in another viewport, or its read (a SELECT) is asked
 * again as the owner; a write is never re-run. Tokens are never printed.
 * Used by: toolbox-check-command.mjs.
 */

/** Fills the owner detail on the checks in place; returns the result's callFailures, only when
 * present. Never throws. */
export async function explainCalls(client, id, checks, guestRun = false) {
  const failures = checks.flatMap(check => check?.callErrors ?? []);
  if (!failures.length) return {};
  const shown = new Map(failures.filter(f => f.detail).map(f => [f.field, f.detail]));
  for (const check of checks)
    for (const failure of check?.callErrors ?? []) {
      const {replay} = failure;
      delete failure.replay;
      if (failure.detail || !(guestRun || check.viewer === 'guest')) continue;
      failure.guest = true;
      if (shown.has(failure.field)) failure.ownerDetail = shown.get(failure.field);
      else if (replay) Object.assign(failure, await asOwner(client, id, replay));
      else failure.notReplayed = true;
    }
  const failed = new Map();
  for (const failure of failures) {
    const {field, kind, message, code, detail, guest, ownerDetail, ownerPasses, notReplayed} =
      failure;
    const shape = {field, kind, message, code, detail, guest, ownerDetail, ownerPasses,
      notReplayed};
    failed.set(JSON.stringify(shape), JSON.parse(JSON.stringify(shape)));
  }
  return failed.size ? {callFailures: [...failed.values()].slice(0, 8)} : {};
}

/** The same read as the owner: the detail of the same call, or that it succeeds. */
async function asOwner(client, id, replay) {
  try {
    await client.request(`/api/artifacts/${id}/sql`,
      {safeToRepeat: true, timeoutMs: 8000, method: 'POST', body: replay});
    return {ownerPasses: true};
  } catch (error) {
    // sql refuses with a status: the refusal's detail, or its message.
    const refusal = error?.details, said = refusal?.detail ?? refusal?.message;
    return typeof said === 'string' ? {ownerDetail: said.slice(0, 200)} : {};
  }
}
