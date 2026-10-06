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
