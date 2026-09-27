/**
 * Browser-safe transport seam for the artifact page (lib/artifact-page): the
 * wire carries each thing once, and the page expands it at consumption.
 *
 * A DOCUMENT's surface carries its prepared runtime and no raw sheet
 * (`compiledCss` absent) and no second copy of its dataflow: the declarations
 * ride inside the runtime's island, which is where the document reads them.
 * The data tiers carry their stored sheet as they always have.
 */
interface TransportSurface {
  compiledCss?: string | null;
  dataflow?: unknown;
  runtime?: { data?: { dataflow?: unknown } };
}
/** The surface props the page renders from, whatever shape the wire carried them in. */
export function expandSurface<T>(surface: object): T {
  const wire = surface as TransportSurface;
  return { ...wire, compiledCss: wire.compiledCss ?? null, dataflow: wire.dataflow ?? wire.runtime?.data?.dataflow ?? null } as T;
}
