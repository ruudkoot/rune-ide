# Rune IDE

A desktop environment for Standard ML, built with Electron, Dockview,
Monaco, and React Aria Components. Workspace and application behavior runs
in a separate Standard ML service compiled by Rune.

Development is in this repository. `/home/ruud/rune` is a **read-only**
toolchain/source input; changing it requires permission. Its existing
`bin/rune` and `bin/runevm` must be built before starting here.

```sh
make setup                 # install a local Node 24 and locked dependencies
make dev                   # compile the SML service and launch the IDE
make check                 # Rune service, TypeScript, protocol integration tests
make check-hosts           # same service on MLton, Poly/ML, SML/NJ 64 and 32 bits
make test-ui               # package and exercise the actual Electron application
```

Set `RUNE_ROOT=/path/to/rune` to use another toolchain. These commands write
only to this repository. `make setup` needs npm and network access; build
scripts need Python 3. UI tests require a working graphical display.

The Linux development package is `out/Rune-linux-x64/rune-ide`. At this stage
it includes service bytecode but still uses `RUNE_ROOT/bin/runevm` at runtime;
self-contained cross-platform distribution belongs to milestone M4.

See [the roadmap](docs/plans/ide.md), [architecture and behavior](docs/ide.md),
and [the protocol](docs/ide-protocol.md). Commit subjects follow Rune's master
branch: an imperative description followed by the milestone, such as
`Connect the desktop workbench to an SML service (IDE M1)`.
