# Separately verified migration capacity

The normal importer measures aggregate normalized HTML storage before applying. This remains the default, including retries.

A trusted operator who has independently verified sufficient destination capacity for the complete selected corpus may pass `--capacity-verified` together with `--apply-isolated` to `scripts/migration/import-stream.ts`. The typed job equivalent is `storageCapacity: "operator-verified"`. Keep the independent capacity evidence with the private operator run records. The importer does not discover or validate that external capacity evidence.

This option skips only the aggregate storage measurement pass. It does not skip source verification, global planning, dependency readiness, compiler provenance, per-page normalized source limits, destination transactions, compare-and-swap checks, or final verification. It requires serial apply and cannot be combined with `--measure-storage` or verify-only mode. Dry runs cannot use it.

The resulting summary records `storageCapacity: "operator-verified"` and omits `storageReport`; no aggregate storage report is produced. If measured byte totals are required, run `--measure-storage` separately or retain the default apply behavior.
