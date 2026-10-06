/** Deliver one real response before the UI navigates; return its outcome to the awaiting gate. */
export async function jsonRouteResponse(route) {
  try {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response });
    return { response, body };
  } catch (error) {
    await route.abort('failed').catch(() => {});
    return { error };
  }
}

/** Validate creation before a gate waits for controls on the new document. No replay. */
export function createdDocumentResponse(result) {
  if (result.error) throw result.error;
  if (result.response.status() !== 201) throw new Error(`Document creation returned HTTP ${result.response.status()}`);
  if (typeof result.body?.id !== 'string' || !/^[A-Za-z0-9]+$/.test(result.body.id)) {
    throw new Error('Document creation returned no valid artifact ID');
  }
  return result;
}
