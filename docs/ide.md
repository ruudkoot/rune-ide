# Architecture and development

The renderer contains React adapters for Dockview, Monaco, and React Aria.
The SML service owns workspace rules, document revisions, safe saves, build
targets and result validation. A separate SML adapter collects compiler diagnostics. Electron main supplies native
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
and renames the sibling into place. M4.1 also flushes the parent directory
before clearing the recovery record. Failed saves retain the dirty buffer.
This is Linux replacement behavior, not a lock against another writer racing
the final check or a guarantee against filesystem/hardware failure. ACLs, extended attributes,
hard-link identity, Windows replacement semantics and file watchers are M4 work.

Files larger than 512 KiB, non-UTF-8 data, binary/control characters, mixed
line endings and lone-CR text are explicitly rejected in this first editor.
Acknowledged edits have a separate recovery journal (M4.1, below). New file
creation and rename remain follow-ups.
Tests edit temporary fixtures; the Rune checkout remains read-only.

## Compilation (M3)

Save and Build (Ctrl+Shift+B) saves pending documents, compiles an ordered target
in a fresh Rune VM, and publishes an `.rbc` file only after a successful,
non-stale result. Cancel Build terminates that child; both output streams are
drained while it runs and the retained log is capped at 128 KiB of characters.
Output follows the tail unless scrolled back. Problems and Monaco markers use
structured compiler spans, converted from UTF-8 bytes to UTF-16 positions in
SML. Click a problem to select its source span. Later edits remove the affected
markers and label the problem out of date. External diagnostic sources open
read-only. Switching workspace clears the previous build result.

Targets are selected in this order:

1. `.rune-ide.json`, when present (see the example below).
2. `sources.txt`: one workspace-relative source path per line, in compilation
   order; blank lines and lines starting with `#` are ignored. Spaces in paths
   are supported. The default target is `workspace`.
3. The active file, when neither project file exists (`active-file` target).

```json
{
  "version": 1,
  "targets": [
    {
      "name": "app",
      "sources": ["src/types.sml", "src/main.sml"],
      "output": "app.rbc",
      "optimization": 1,
      "noPrelude": false
    }
  ]
}
```

Source paths must resolve inside the workspace. Target names contain letters,
digits, underscores or hyphens. `output` is an `.rbc` filename under `.rune-ide`,
not an arbitrary destination. `optimization` is 0 or 1; both it and `noPrelude`
are optional. Each build has a separate work directory with its report and
candidate artifact; a failed build leaves the last successful artifact intact
but does not advertise it as the failed build's output. Build-directory cleanup remains an M4 follow-up. The Toolchain button selects a
Rune installation containing `bin/runevm` and `lib/basis/MANIFEST` and persists the choice. Compiler/Basis compatibility still requires a matching Rune checkout.

The IDE bundles `build/compiler.rbc`: an SML diagnostic adapter compiled by the
existing self-hosted Rune compiler from read-only compiler sources. It shadows
only `Error.format` and `Error.warn`, then calls the existing `Main.main` in a
fresh process. Capturing final error formatting avoids treating parser
backtracking exceptions as user errors. No compiler source is copied or patched,
and Rune has not acquired a new CLI flag. The adapter takes its report path as
its first argument, then ordinary compiler arguments. It preserves human output
and status, and emits a version-1 JSON result with severity, message, byte spans,
UTF-16 ranges and compiler version. Its source/Basis/bootstrap fingerprint and
Rune HEAD are recorded in `build/compiler-info.json`, included in the package.
The build script checks inputs again after compiling to detect concurrent edits.

The SML service checks report schema and process outcome, document revisions,
and saved source bytes before publishing. Missing/malformed reports and crashes
produce a visible failure. This checks for external modifications, without
claiming an atomic filesystem snapshot. A diagnostic report is limited to
512 KiB. The toolbar measures save, child execution, report/publication and
marker-application time separately; semantic conversion happens inside the
compiler child. There is one active build per workspace and no incremental
compiler session yet. Run/debug integration is a later milestone.

Validation includes real multi-file builds, wrong source order, byte-for-byte
comparison with the existing CLI, syntax/type/warning diagnostics and Unicode
spans on all SML hosts. Process tests cover pipe draining, bounded logs,
cancellation, launch/crash failures and quitting during preparation. Packaged
Electron tests cover save failure preventing a build and the complete
build → navigate diagnostic → edit → save → successful rebuild loop.

## Sessions and recovery (M4.1)

SML owns the versioned session file and dirty-buffer journals under Electron's
user-data directory, in `ide-state/`. On Linux the profile is normally under
`~/.config/`, named for the application; `RUNE_IDE_USER_DATA` overrides it for
isolated testing. Only one app instance may use a profile. A second launch
focuses the existing window.

The app restores the last workspace, docked tabs/splits, editor cursor/scroll
positions, tree expansion/selection, excluded-file preference, build target
and toolchain. The renderer supplies Dockview/Monaco view data, bounded to
256 KiB, while SML validates its version and persists it. View changes are
coalesced for 400 ms and flushed before an accepted quit. Missing clean files
are skipped with an error; a missing workspace can be replaced using Open
Folder. Floating/popout/edge layouts are not restored in this checkpoint.

Each edit acknowledgement follows an atomic journal replacement: private
0600 file, full write, fsync, rename, and directory fsync on Linux. Journals
contain UTF-8 text, original saved baseline, BOM, workspace/path and revision.
They are separate from source files. A storage failure rejects the edit
acknowledgement, retains the previous service revision, and leaves Monaco's
local text available. Edits still in transit when the whole application dies
are not guaranteed to be recoverable. Ordinary filesystem/hardware durability
limits still apply; native replacement semantics need verification on other OSes.

After a crash, the recovery banner offers Restore or an explicitly confirmed
Discard. Restore keeps the original saved baseline so externally changed
sources still produce a save conflict. Restoring never writes source bytes.
A record whose text already reached disk is recovered cleanly. Files or roots
that disappeared are reported and their journals retained; automatic recreation
or exporting a missing file is not implemented yet. Save, undo back to the saved
baseline, or an accepted Discard clears the active record. Quitting normally
clears only buffers handled by Save/Discard, keeping unhandled recovery offers.

Recovery is bounded to 64 valid buffers and 16 MiB of encoded records, with
a 4 MiB read limit per record and the existing 512 KiB document limit. Excess
or malformed records are preserved on disk with a warning; excess valid
records can be loaded on a later restart after saving/discarding others.
Corrupt session metadata is renamed rather than overwritten. Preservation of
invalid/excess files can leave the directory larger than the active quota.

If the SML process fails, editors become read-only and offer Restart service.
The new service receives current Monaco text and its saved baseline before
editing resumes. The same models and undo history survive this reconnection;
undo history is not serialized across application restarts. Active compilation
is cancelled on service failure. This is process recovery, not compiler-session
reuse.

Validation covers forced termination/relaunch, split layouts and preferences,
service restart/undo/save, Unicode/BOM/CRLF, original conflict baselines,
failed journal writes, corrupt metadata, missing paths and quota overflow.
All service checks run on Rune and the four supported host compilers. Packaged
Electron tests use separate profiles and temporary sources.
Playwright sets `RUNE_IDE_TEST_BACKGROUND=1`: Electron creates a hidden window
with offscreen rendering and background throttling disabled, so tests and
screenshots run without raising a window or taking desktop focus. Normal app
launches are visible.
