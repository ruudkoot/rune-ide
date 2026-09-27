# Rune IDE

A desktop environment for Standard ML, built with Electron, Dockview,
Monaco, and React Aria Components. Workspace and application behavior runs
in a separate Standard ML service compiled by Rune.

Development is in this repository. `/home/ruud/rune` is a **read-only**
toolchain/source input; changing it requires permission. Its existing
`bin/rune` and `bin/runevm` must be built before starting here.

```sh
make setup                 # install a local Node 24 and locked dependencies
make millet                # generate Millet's MLB for service, compiler adapter and example
make dev                   # compile the SML service and launch the IDE
make check                 # service/compiler, TypeScript and process integration tests
make check-hosts           # same service on MLton, Poly/ML, SML/NJ 64 and 32 bits
make test-ui               # package and exercise Electron with hidden windows
make archive               # self-contained Linux archive and SHA-256 checksum
make test-windows          # package and test native Windows through WSL2
make archive RUNE_IDE_PACKAGE_PLATFORM=win32  # Windows portable ZIP and checksum
```

Set `RUNE_ROOT=/path/to/rune` to use another toolchain. These commands write
only to this repository. `make setup` needs npm and network access; build
scripts need Python 3. UI tests require a working graphical display.

Millet reads `millet.toml`, which points to the generated `build/ide.mlb`.
Run `make millet` after changing either source manifest or `RUNE_ROOT`;
`make service` also regenerates it. The service, compiler adapter, and example
have separate MLB scopes. Generation reads Rune's existing sources and
`build/config.sml` without modifying that checkout.

Start the packaged Linux app with:

```sh
env -u ELECTRON_RUN_AS_NODE ./out/Rune-linux-x64/rune-ide
```

For Windows, extract `out/Rune-win32-x64.zip` to a local Windows directory
and launch `Rune-win32-x64/rune-ide.exe`.

Both packages are self-contained: their resources include the Rune VM,
service, compiler adapter and matching Basis. They need neither Node nor a Rune
checkout at runtime. `RUNE_ROOT` is an optional runtime override.
`make archive` creates `out/Rune-linux-x64.tar.gz` and its checksum; these are
unsigned private development artifacts. See [distribution](docs/distribution.md)
for validation and release gates.

M1–M3 are implemented: open a folder, browse/edit/save sources, and use
**Save and Build** to compile an ordered `sources.txt` (or `.rune-ide.json`
target). Click Problems to navigate compiler diagnostics. With no project
manifest, the active source file is the target. See the architecture document
for the target format and current limits. M4.1 adds saved workbench sessions,
crash recovery for acknowledged unsaved edits, and service restart without
losing the live editor models or undo history. M4.2 adds watching and file
operations. M4.4 adds **Commands** (Ctrl+Shift+P), keyboard panel navigation,
three persistent themes and a virtualized explorer; see [usability](docs/usability.md).
M4.5 validates the editing/build/recovery loop in native Windows through WSL2;
macOS native testing remains deferred. M4.6 cleans up each completed build's
temporary files while retaining published artifacts.

For a first run, open this repository's [examples/hello](examples/hello) folder
and click **Save and Build**. Change the string in main.sml, or introduce a type
error in greeting.sml to try diagnostic navigation.

See [the roadmap](docs/plans/ide.md), [architecture and behavior](docs/ide.md),
and [the protocol](docs/ide-protocol.md). Commit subjects follow Rune's master
branch: an imperative description followed by the milestone, such as
`Connect the desktop workbench to an SML service (IDE M1)`.
