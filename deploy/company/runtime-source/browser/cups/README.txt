Shared same-trixie libcups-only source recipe

Consumer contract
Fork a disposable builder FROM the actual final runtime-profile before adding
builddeps or custom source overlays. Copy this helper directory into it. Run:
  sh /runtime-build/cups/build-cups.sh
If libcups2t64 is absent before builddeps, recipe exits without adding it.
Otherwise /out/libcups2t64.deb is produced; install it after all runtime apt steps.
/out/check-ipp is a disposable test tool, not a shipped package. Mount it plus
check-cups.py into an ephemeral final-image validation container and run:
  python3 check-cups.py /test-tools/check-ipp
The checker needs Python3 only; no compiler/dpkg-dev/sshd/printer service. It runs
valid HTTP/IPP on127.0.0.1 with no external calls/hardware/credentials and compares
the actual loaded library hash to installed package provenance. Keep full final
inventory/all-severity scan artifacts. Do not install builddeps into runtime.

Copyable consumer inputs (no source archives/build binaries required)
build-cups.sh,package-cups.py,fetch-cups.py,check-cups.py,check-ipp.c,
downloads.json,release-key.asc,SHA256SUMS,README.txt.

Source/provenance
Official OpenPrinting2.4.20 latest release, sourceSHA256:
ab4d9cd7f3e58060091d2b24972223d6401675f11c49b65abf4f6ef31dea22ff
Vendor GitHub API asset digest independently equals downloaded archive hash.
Detached signature/key verified in hosted build, not yet cryptographically
verified locally. Official release author zdohnal's GitHub key fingerprint
7082A0A50A2E92640F3880E0E4522DCC9B246FF7 equals signature issuer fingerprint;
key checksum is pinned in manifest. Evidence release.json/downloads.json and
release-key-provenance.json. Baseline Debian2.4.10-3+deb13u2 source patch series
was retrieved read-only (debian-baseline.tar.xz); it contains no new seven
candidate fix patches by name. This alone is not semantic proof no equivalent
backport exists; primary source review is retained conservatively.

Compatibility
Only installed libcups2t64 payload replaced: libcups.so.2. All original exported
versioned ABI entries, original DT_NEEDED features, GnuTLS backend, GSSAPI,
Avahi DNS-SD and compression must survive. Exact source supports those options.
Original package payload/docs/config examples/control Depends+PreDepends,
maintainer scripts/triggers/conffiles/symbols, ownership/modes are preserved;
same-base dpkg-shlibdeps adds actual new dependencies. Original symbols metadata
remains valid because all old exports must be present; shlibs truthfully pins
newpackage floor. UpstreamLICENSE/source digest +actualbuiltlibrarySHA recorded.
No cupsd/backend/notifier/filter/CLI/server package enters final image. Upstream
array regression is built and run; valid loopback IPP/URI and loaded ABI checks
run against staged library then must run again against actual final installed
library. ABI/feature/DT_NEEDED checks fail instead of silently reducing features.

Advisory scope and residual
Six runtime fix groups present in2.4.20:39314, TEMP51E1F8, TEMP71B844,
2025-58436,2026-107655,2026-34990 (full IDs/source evidence in applicability.json).
Three mixed groups concern absent daemon entrypoints but shared library patches
are preserved conservatively. Twenty daemon/backend-only source matches remain
excluded for this exact libcups-only image, never for images containing cupsd.
CVE-2026-87875 is a distinct conditional residual: official2.4.20 change only
DEPRECATES cupsUTF32ToUTF8 in transcode.h. API/implementation remains exported,
requires a source string yet has no source-length parameter. A compatible ABI
replacement cannot claim the unsafe optional API has been removed/fixed for all
callers. No actual application caller/nonterminated input path was established.
Do not suppress it or label all seven completely fixed merely from version.

Validation truth
LocalPASS: Python syntax, shell syntax, C fixture syntax against exact source
headers; normal loopback IPP/URI fixture actually compiled+ran against hostmacOS
systemlibcups (fixture correctness only, NOT Linux/candidate proof); vendor
source+signature digest replay; signature issuer/key fingerprint match.
UNRUN required hosted gates: GPG signature verification, trixie source build,
upstream array regression, sharedABI/feature preservation/package generation,
stagedcandidatefixture, finalimagefixture/inventory/allseverityscan. No local
shared Docker builds or deployments. No malformed-input/adversarial tests.

Primary references
https://github.com/OpenPrinting/cups/releases/tag/v2.4.20
https://api.github.com/repos/OpenPrinting/cups/releases/latest
https://github.com/zdohnal.gpg
https://salsa.debian.org/printing-team/cups/-/raw/debian/2.4.10-3/debian/rules
https://github.com/OpenPrinting/cups/security/advisories/GHSA-559w-7676-3xrq
https://github.com/OpenPrinting/cups/commit/2b1dc178a2d2325135b855142e384f4e8c42d8e4

Bootstrap: POSIX dpkg-query captures eligible names/versions before Python or
build tools. Empty profiles exit before installing anything. A builder-only
Python/dpkg-dev/binutils bootstrap then snapshots only that explicit profile,
asserting bootstrap did not change any eligible runtime version. It never
infers runtime eligibility from development dependencies.
