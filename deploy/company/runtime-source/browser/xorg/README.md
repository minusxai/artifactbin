# Browser component source candidate

This shared candidate is not yet validated by a Linux build. Run the source gates,
final native probe, existing application/browser gates, and a fresh all-severity
image audit before accepting it. It does not claim that all X.Org findings are fixed.

The six official release archive SHA256 values in `source-receipts.json` were
independently matched to the linked official release-announcement checksums.
Detached signatures have not been verified. The extracted release ChangeLogs
contain the reviewed October fixes and xkbcomp parser fixes in `primary-records.json`. X server
CVE-2023-5574 remains a separately recorded unresolved finding.

## Integration

1. Capture the **untouched actual runtime** package inventory with
   `capture-profile.sh /xorg-profile` before any build dependency installation.
   Use the identical Debian base/digest and architecture for compilation.
2. Install the builder prerequisites listed in `Dockerfile.proof`, then run
   `build.sh`. Four client libraries are compiled with their normal upstream
   interfaces and tests. Xvfb is compiled only when present in the captured runtime.
   Xvfb retains the reviewed Debian extensions, GLX, security extension, XSELinux,
   DRI, font paths and XKB paths. No Xorg/Xnest/Xephyr binaries are introduced.
3. Mount `/out` into the original runtime stage and install only the emitted
   `*.deb` files. Explicitly include `/usr/share/doc/<package>/*` during dpkg install
   so Debian slim image exclusions do not drop licenses/provenance. Run
   `apt-get check`. Preserve the production USER/ENTRYPOINT/CMD and browser setup.
4. Mount `check-xorg` and `check-display.sh` as test fixtures; execute the latter
   in the final image. It launches a temporary local Xvfb without TCP, exercises
   X11 drawing, XI2 device queries, XRender, XPM and software GLX, then cleans up.
   Existing Chromium/Playwright drawing/screenshot and application gates are also
   required; this fixture complements them.
5. Save the tested image ID and a privacy-filtered, all-severity Trivy report that
   includes every result/no-fix entry. Inspect actual installed package inventories
   and source receipts; source-package matches for unchanged data packages require
   component-specific triage rather than blanket version clearance.

`Dockerfile.proof` is a hosted standalone proof harness using an existing complete
browser image via `RUNTIME_IMAGE`; it is not a production replacement Dockerfile.
No new runtime package is emitted because a builder dependency happened to install
it. Packages outside the captured profile remain untouched. `xserver-common`
contains unchanged Debian integration data, keeps its original distro version and
is not emitted. The actual Xvfb binary is rebuilt and honestly versioned. Existing
client development packages, if captured, have their actual headers/static archives
replaced too; missing upstream interfaces fail packaging. Library exported symbol
names and versions must include the captured baseline ABI before packaging.

Original policy fields, dependency relationships, maintainer scripts and conffiles
are retained. Runtime ABI dependencies are additionally derived from rebuilt ELF
files against an exact local shlibs map. Package epochs are preserved. New C ELF
files are stripped after ABI comparison to avoid shipping builder debug sections.
Original Debian integration scripts and ancillary documentation remain explicitly
identified as retained integration payloads in each source receipt.


## Keyboard compiler backport

The original Debian `x11-xkb-utils`7.7+9 source archive contains xkbcomp1.4.7
alongside six other programs. The 1.5.0 official release contains all four exact
parser-fix commits for CVE-2018-15853/15859/15861/15863. Its archive checksum was
matched to the official December2025 release announcement; the baseline checksum
was matched to Debian's published source-control file.

When the original runtime contains this bundle, only xkbcomp and its own manual
and pkg-config payload are replaced. The honest package version is
`<original-version>+xkbcomp1.5.0-1+runtime1`; Source remains `x11-xkb-utils`.
Other installed utility bytes and interfaces remain unchanged and their hashes
are recorded explicitly. This does not claim all bundled programs are version1.5.0.

The new required selective build input is `check-xkb-expressions.c`. It includes
unchanged upstream expression/predicate code and directly exercises boolean
negation, invalid identifier atoms, invalid field/array atoms and predicates
missing arguments. The source gate builds the actual Debian baseline and requires
all four defects to reproduce as assertion/signal failures (timeouts or loader
failures are rejected), then requires all four cases to pass against1.5.0. These
Linux red/green gates are prepared, not yet claimed passed. Core dumps are disabled
and every case has a five-second wall-clock limit. Both expression harnesses use
`-O0 -fno-optimize-sibling-calls` so recursion produces an observable stack failure
rather than a compiler-transformed infinite loop; installed programs retain the
normal optimized hardening flags. The final live Xvfb probe also
compiles, uploads and decompiles its keyboard map using the installed xkbcomp.
