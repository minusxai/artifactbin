# Document helpers

This module owns native document titles, asset addresses, CSP declarations, social preview settings, and durable annotation ranges. It performs no I/O; persistence belongs to `lib/artifacts` and publication to `lib/publish`.

Browser consumers use the leaves listed in `DEEP_MODULES['lib/document']`; other consumers use the index. Keep the module below the browser bridge and persistence layers, and preserve annotation identity and access boundaries.
