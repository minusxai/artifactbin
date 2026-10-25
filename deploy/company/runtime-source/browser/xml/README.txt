Shared XML library candidate — Linux package build remains unrun

Copy only build-xml.sh, prepare.py, verify-exports.py, check-xml.c and patches/ into a disposable builder based on the exact consumer Debian image. Run sh build-xml.sh /out. Do not copy this entire investigation directory or add libxml2 to a final image that lacks it. The output runtime is /out/libxml2.deb; exports/logs are proof artifacts, not extra runtime dependencies.

The recipe retains Debian source/build flags, package split/control/dependencies and normal upstream tests. It restores official same-release test/result fixtures omitted by Debian dfsg and W3C fixtures; explicit count assertions prevent a zero-case pass. It checks original exported symbol names/versions, then links a public-API regression against the new library. Consumer Linux builds, existing Chromium/product native tests, and final image scan/loaded-library inventory are still required.

CVE-2026-6653 official stable-distribution backport appends fields to public xmlEntity/xmlParserInput structures. Symbol checks do not prove compatibility for callers that manually allocate these structs; do not claim complete ABI equivalence. Existing application/binary consumers must run against the final Linux package.

Host evidence: AppleClangASAN+UBSAN public API test passed; upstream3349 normal tests,9 recursion cases and280912generated API cases zero errors. W3C2269cases had15explicitlyexpected errors,0leaks. Dedicated testcatalog also exited0. Host omitted optional compression/ICU/Python, so this is source/regression evidence only. Linux recipe was not executed on the shared full Docker VM.

Eight bounded patches cover eight applicable source issues.86139 has an equivalent guard already in exact Debian source;86141 is absent original source but its null-allocation guard is included together with the86137 bounds backport. Six patches are byte-identical Canonical2.9.14backports;76781 adapts context only; regexp combines two official changes against the older parser structure. Sources and bytes are pinned; OpenPGP verification is not claimed.
