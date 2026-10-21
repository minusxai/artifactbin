/** Raise the shared transport-neutral status error; HTTP mapping belongs to the adapter. */
export function fail(status: number, message: string): never {
  throw Object.assign(new Error(message), { status });
}
