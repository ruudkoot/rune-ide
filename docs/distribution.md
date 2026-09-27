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

Windows native validation via WSL2 is the next distribution checkpoint.
macOS native testing is deferred by the owner. Signing/notarization,
installer choice and authenticated updates remain release gates; no update
endpoint or signing identity is configured and no automatic downloads occur.
