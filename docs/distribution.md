# Distribution

`make package` builds a self-contained Linux x64 directory. `make archive`
also creates a tar.gz and SHA-256 file. These are unsigned development builds;
the scripts neither publish nor install them. Normal launches show a window;
Playwright uses an offscreen window via `RUNE_IDE_TEST_BACKGROUND=1`.

Resources contain the service and compiler bytecode, compiler provenance,
an existing Rune VM, and the matching Basis tree. Staging reads Rune without
modifying it, validates the VM architecture and compiler/Basis fingerprint,
and rejects changes to inputs during copying. `bundle-info.json` records
resource hashes. Run `python3 scripts/verify-package.py out/Rune-linux-x64`
to check them without access to Rune. Checksums detect corruption; they do
not provide publisher authentication.

The packaged default toolchain is relative to Electron's resources directory.
Selecting an external toolchain persists its path; selecting the bundled
default persists null, allowing relocation. `RUNE_ROOT` remains an explicit
override. Package resources are read-only inputs at runtime. Workspace build
outputs and per-user recovery/session data remain outside the application.

The Linux portability test copies the package to a path containing spaces,
starts with an empty executable search path and no `RUNE_ROOT`, edits/builds
a temporary project, relocates the package, then restores the same profile
and builds again. The output is executed with the bundled VM. This establishes
independence from Node and a Rune checkout; it does not establish compatibility
with every Linux distribution or its system libraries.

Native Windows x64 validation through WSL2 also passes, as recorded below.
macOS native testing is deferred by the owner. Signing/notarization,
installer choice and authenticated updates remain release gates; no update
endpoint or signing identity is configured and no automatic downloads occur.

## Windows from WSL2

`make package RUNE_IDE_PACKAGE_PLATFORM=win32` prepares a native x64 Windows
folder. The existing `RUNE_ROOT/bin/runevm.exe` is an input. The staging script
strips COFF symbols from its own copy and embeds an application manifest
requesting UTF-8. It records both source-VM and prepared-resource hashes.
The input Rune executable is never edited. A PE strip utility (here
`x86_64-w64-mingw32-strip`, or `RUNE_IDE_STRIP`) and the locked `resedit`
package perform this preparation. Signed inputs and existing VM manifests are
rejected for explicit reconciliation, rather than silently changing them.
Microsoft documents [the per-process UTF-8 manifest setting](https://learn.microsoft.com/en-us/windows/apps/design/globalizing/use-utf8-code-page).

`python3 scripts/test-windows.py` copies the package to a new directory in the
Windows user's LocalAppData/Temp, invokes native Electron through PowerShell,
and removes that directory afterward. Test profiles/workspaces are temporary.
Electron's Node mode runs the test driver, so a Windows Node installation is
not needed. The actual tested application clears that mode and runs hidden;
its service/compiler children also hide their consoles. Tests access native
NTFS paths, including spaces and Unicode, with a search path containing only
Windows system tools. Results and screenshots are written to
`test-results-windows/` in this repository.

The 2026-09-27 acceptance run passed on Windows 11 x64 (build 22000), using
native Electron and the bundled Windows VM on NTFS. The final driver took 9.3 s,
excluding package copying. It checked Unicode filenames/content, BOM/CRLF
preservation, compilation and artifact execution, type-error navigation and
rebuilding, completed-build cleanup, native watch reload, dirty conflict copies, case-insensitive
filename collisions, rename/trash, forced-termination recovery, and keyboard
palette/theme switching. The window remained hidden and the renderer reported
no uncaught errors. The light-theme screenshot was also visually inspected.
The wrapper requires a fresh success report; a deliberately failing native
Node-mode process separately verified nonzero exit propagation through
PowerShell. These checks do not establish support for older Windows versions
or other architectures.

The portable ZIP is an unpack-and-run development distribution. Extract it to
a local writable destination and launch `rune-ide.exe`. Installation into
Program Files, file associations, elevation, an installer and automatic
updates are not configured. Replacing a portable bundle requires closing the
IDE first; its per-user profile lives outside the package. macOS packaging
requires a matching native VM input, but native execution testing is deferred.

## Publication gates

Before public distribution, choose the installer/update channel and supply its
signing identity. Sign the final prepared VM and Electron bundle, regenerate
resource checksums after signing, then test signature verification and startup
on a clean Windows account. macOS additionally needs native builds, signing,
notarization and Gatekeeper checks. Linux distribution/system-library
compatibility needs a defined support matrix.

Updates need an authenticated source and tests for old/new app versions,
profile migration, interrupted downloads, rejection of a tampered payload,
rollback and an unsaved-buffer restart. None of these results can be inferred
from unsigned local ZIPs. See Electron's [code-signing](https://www.electronjs.org/docs/latest/tutorial/code-signing)
and [update](https://www.electronjs.org/docs/latest/tutorial/updates) documentation.
Native screen-reader, real IME composition and multiple display-scale checks
also remain human release validation. Automated hidden-window checks cover
only the behaviors listed in their recorded results.
