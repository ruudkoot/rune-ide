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
welcome editor. M2 adds document tabs and shared split views.

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

## Editing (M2)

Open existing UTF-8 text files with Enter or a double click. The tree's Show
Excluded checkbox includes dotfiles and generated directories; Refresh reloads
expanded directories while retaining selection. Tabs use paths relative to the
workspace, so duplicate basenames are distinguishable. Split Editor creates
another view of the same Monaco model and undo history. Find/replace is Monaco's
Ctrl+F / Ctrl+H. File/View menus also expose the editing commands.

The SML service owns document text, revisions and dirty state. Monaco sends
simultaneous edits in UTF-16 units; SML validates the revision and converts to
UTF-8 byte offsets. Native Save/Discard/Cancel prompts protect closing a dirty
file, changing workspace and quitting. A failed edit acknowledgement retains
the local buffer and blocks saves instead of silently desynchronizing it.

Save and Save All preserve a UTF-8 BOM, uniform LF/CRLF endings, and POSIX
permissions. A save compares current disk bytes with the last loaded/saved
version, writes an exclusive temporary sibling, flushes it, checks disk again,
and renames the sibling into place. Failed saves retain the dirty buffer.
This is Linux replacement behavior, not a promise of crash durability or a
lock against another writer racing the final check. ACLs, extended attributes,
hard-link identity, Windows replacement semantics and file watchers are M4 work.

Files larger than 512 KiB, non-UTF-8 data, binary/control characters, mixed
line endings and lone-CR text are explicitly rejected in this first editor.
The buffer remains in memory until the application exits; crash recovery and
session restoration are M4 work. New file creation and rename are also follow-ups.
Tests edit temporary fixtures; the Rune checkout remains read-only.
