# Architecture and development

The renderer contains React adapters for Dockview, Monaco, and React Aria.
The SML service owns filesystem/workspace rules; later milestones add
document, build, and compiler models there. Electron main supplies native
dialogs and child-process lifecycle, relaying a narrow preload API. The
renderer has context isolation and sandboxing, without Node access.

`sources.txt` orders the SML modules. `scripts/build-service.py` invokes the
existing Rune compiler with an output under `build/`; it never builds or
modifies the Rune checkout. The application starts that bytecode in a fresh
Rune VM. `RUNE_ROOT` selects the toolchain, defaulting to `/home/ruud/rune`.
The host monitors the service and exposes startup or unexpected-exit errors
in the workbench. Closing the application shuts down the service.

The service uses raw `Posix.IO.readVec` reads from stdin, not buffered
`TextIO.input1`: Rune's buffered pipe read can wait for a full buffer and
deadlock a request/reply exchange. Message framing still happens in SML.
There are no new Rune runtime primitives or compiler changes.

Workspace paths are canonicalized by SML and directory requests must remain
inside the chosen root. Listings are lazy and deterministic, directories
first. Hidden files and common generated directories are excluded by
default. Symlinks are displayed but the frontend does not expand directory
links. Individual directory failures appear in Output. The initial UI
supports one workspace/window, with dockable Explorer and Output and a
read-only welcome editor. Actual document editing is M2.

Frontend package versions are locked. The build uses Electron Forge's
Webpack integration, with only the Monaco editor API and find contribution
imported. Production minification is disabled during the initial milestones
to keep the build small in complexity and quick to inspect; release tuning
belongs to M4. Monaco workers are emitted by the Webpack plugin.

`make check` runs TypeScript checking and sends real framed messages to the
Rune service. `make check-hosts` builds the same SML modules using the four
installed compiler hosts and repeats those tests. `make test-ui` builds a
Linux application and runs Playwright against it, including native dialog
stubbing and actual filesystem requests. UI tests leave a screenshot under
`test-results/`. A passing Linux run does not establish Windows/macOS support.

When changing the application, run the checks relevant to the milestone,
update behavior/protocol documentation and the roadmap, then commit that
milestone. Do not run builds/tests that mutate `/home/ruud/rune` without
the owner's permission.
