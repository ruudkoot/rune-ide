# A Rune IDE

Build a standalone IDE with Electron, Dockview, Monaco, and React Aria
Components. The IDE should eventually expose Rune's compiler and runtime in
depth, with as much application logic as practical written in Standard ML.
The first useful release is concrete: open a directory, browse its source
tree, edit files, compile them with Rune, and navigate errors and warnings
inside the editor.

This is an implementation roadmap, not a description of existing features.
Paths, commands, protocol methods, and compiler options proposed below do
not exist yet unless explicitly identified as current. Proceed in milestone
order, with a working demonstration at each gate. Components that work only
in isolation do not complete a milestone.

## Status and order

| Milestone | Deliverable | Depends on | State |
|---|---|---|---|
| M0 | This roadmap and the stack decision | — | planned and documented |
| M1 | Desktop shell connected to an SML service | M0 | complete on Linux |
| M2 | File browser and source editor | M1 | complete on Linux |
| M3 | Rune compilation with structured IDE feedback | M2 | complete on Linux |
| M4 | Reliable daily editing, recovery, and distribution | M3 | M4.1–M4.3 complete on Linux; remaining checkpoints below |
| M5 | Shared SML presentation logic and interactive compiler services | M3; incremental interfaces where available | not started |
| M6 | Execution, evaluation, and runtime inspection | M4; M5 for semantic evaluation; runtime prerequisites | not started |
| M7 | Advanced compiler tools and measured product polish | relevant parts of M4–M6 | not started |

**M2 is the first visible deliverable. M3 is the first useful IDE release.**
Keep M1 small enough to support those two milestones directly. M4 can proceed
independently of the compiler work in M5. Incremental compilation, a REPL,
a general FFI, a browser compiler, a debugger, and an extension system are
not prerequisites for M3.

Develop the first release on Linux, using the current Rune environment.
Design paths, protocols, shortcuts, and host interfaces for Windows and
macOS from the beginning; claim support for an operating system only after
running the packaged application there. M4 adds those release gates.

## Decisions

### The UI stack

| Component | Choice | Responsibility |
|---|---|---|
| Desktop host | Electron | Native windows, dialogs, lifecycle, process supervision, OS integration |
| Layout | Dockview, with its React integration | Docked panels, editor groups, tabs, resizing, layout persistence |
| Editor | Monaco | Text models, editing, undo, selection, decorations, editor providers |
| Widgets | React Aria Components | File tree, menus, buttons, dialogs, lists, other accessible controls |
| Rendering adapter | React and TypeScript | Connect the libraries to typed data and commands from SML |
| Application core | Standard ML, compiled by Rune | Workspace, documents, build configuration, commands, diagnostics, later language/runtime services |
| Development and packaging | Electron Forge with its TypeScript/Webpack template | Frontend builds, development launch, desktop distributables |

Choose **React Aria Components**, specifically `Tree`, `TreeItem`, and
`TreeItemContent` for the source tree. Its hierarchical collections, keyboard
navigation, selection, and asynchronous loading fit an explorer whose data
arrives from the SML service. Use the actual Tree control, not an ad hoc
collection of clickable rows. The library is unstyled: provide a compact IDE
theme shared with Dockview and Monaco. Add tree drag-and-drop after browsing
works. [Tree documentation][aria-tree], [styling and installation][aria-start].

Dockview supplies layout, Monaco supplies editing, and React Aria supplies
controls. Workspace semantics belong to Rune. Use one browser renderer for
the initial workbench, with multiple Monaco editors/models as needed; do
not create a browser process per tab. Monaco does not provide a VS Code
extension host. [Dockview][dockview], [Monaco][monaco].

Pin a compatible set of stable package versions and commit the lockfile in
M1. Prove Tree expansion, Monaco workers, and Dockview resizing together
before building more UI. Use public APIs and document compatibility
constraints. Do not depend on private Monaco or VS Code internals.

Use Forge's documented TypeScript/Webpack template for the initial build.
Its Vite integration is currently marked experimental; a bundler change is
independent of the application architecture and can be evaluated later.
[Forge template][forge-template], [Vite plugin status][forge-vite].

### Standard ML owns application behavior

Use a persistent SML service, running in its own Rune VM process, with a
small Electron host and browser presentation layer. This uses Rune itself
from the start and requires no new native bindings.

| Keep in SML | Keep at the library or OS boundary |
|---|---|
| Workspace roots, path identity, directory listing and filtering | Native folder/file dialogs |
| Open documents, acknowledged revisions, dirty/save/conflict policy | Monaco's live text model, undo, selection, input-method composition |
| Command definitions, enablement, application transitions | DOM events, React rendering, focus, pointer movement, docking gestures |
| Ordered compiler inputs, build configuration, scheduling, result interpretation | Spawning, terminating, and draining subprocess pipes |
| Diagnostics, source mapping, stale-result policy, Problems model | Monaco markers and Problems widgets |
| Session data and recovery policy | Dockview's opaque serialized layout and native window geometry |
| Future compiler queries and runtime inspection models | Trees, tables, graphs, and decorations presenting those results |

Use Rune's Basis Library for filesystem operations where available. For
platform adapters such as filesystem notifications or process-group
termination, SML decides the policy and the host executes a bounded request.
Do not move workspace or compiler behavior into Node merely because an npm
library is convenient.

Organize application transitions independently of Electron: conceptually,
`update : state * event -> state * effect list`. Effects describe file work,
host operations, or view updates. This is an organization rule, not a demand
to invent a generic UI framework. Domain models and tests must run without
a browser. The service must stay responsive while compilation runs.

Typing, scrolling, resizing, focus, and composition must not wait for a
service round trip. Monaco applies edits immediately and sends ordered
changes to the SML document mirror. The service acknowledges a revision;
Save and Build wait for the relevant acknowledgement. Do not maintain a
second undo engine in SML or replace a model's whole contents on every edit.

Specify edit coordinates on the wire: zero-based UTF-16 offsets relative
to a named base revision, with a new revision for the resulting batch.
SML converts offsets to its UTF-8 representation and applies a batch without
letting earlier replacements shift later ranges. Reject gaps or conflicting
revisions and request a full resynchronization. Document this separately
from compiler byte spans and Monaco's one-based line/column marker API.

The TypeScript allowance is for adapters and immediate presentation, not
an unrestricted second application core. Review each new non-SML module
against the ownership table. Measure authored code by responsibility;
counting the existing compiler or generated files to inflate an SML
percentage would say little.

LunarML supports browser JavaScript output and JavaScript interoperability.
M5 will test it for shared presentation reducers and view transformations
that need to run beside the UI. This can reduce handwritten TypeScript
further without delaying M2–M3. That browser code runs on JavaScript, not
Rune's VM. Keep foreign calls behind a small binding module and avoid
duplicating compiler semantics. [LunarML][lunarml], [JavaScript interface][lunar-js].

### Processes and boundaries

```text
Electron renderer
  React Aria Tree / Dockview / Monaco / view adapters
             |
             | narrow, asynchronous preload API
             v
Electron main process
  windows, dialogs, IPC relay, child processes
             |
             | versioned messages over stdin/stdout
             v
Rune IDE service — Standard ML on runevm
  workspace / documents / commands / build policy / diagnostics
             |
             | ask host to start a build; receive output and exit events
             v
Fresh Rune compiler process for each build

Later: a separate execution process for the user's Rune program.
```

Use an isolated preload with `contextBridge`; keep Node integration out of
the renderer. Expose explicit operations rather than raw Electron IPC or
arbitrary command execution. Validate messages at the host boundary. These
interfaces also preserve a feasible migration to another desktop host.
[Electron processes][electron-process], [context isolation][electron-isolation],
[IPC][electron-ipc].

The host starts the service, handles its lifecycle, and relays messages.
SML chooses the compiler invocation; the host runs an argument vector with
an explicit working directory and separate stdout/stderr pipes. Never
interpolate workspace paths into a shell command. Terminate a build without
terminating the service. Process-tree termination belongs to the platform
adapter; a POSIX compiler wrapper should `exec` its VM.

Use JSON-RPC 2.0 envelopes over newline-delimited UTF-8 JSON for the initial
service transport. Embedded newlines are escaped inside JSON strings;
accept LF or CRLF framing. Specify maximum message/document sizes, reject
oversized inputs clearly, and handle fragmented or coalesced reads. Large
payloads can acquire explicit chunking later. stdout is protocol-only;
service logs go to stderr. This is an internal protocol, not LSP's transport.
[JSON-RPC specification][json-rpc].

Define the schema once, with SML datatypes/codecs as the domain model and
checked TypeScript counterparts at the boundary. Share examples between
decoder tests; generate bindings if maintaining the small schema by hand
becomes unreliable. Include a version handshake, request IDs, workspace and
session IDs, document revisions, and build IDs. Incompatible versions and
unknown methods produce explicit errors. Coalesce refresh events and bound
log queues so a noisy child cannot starve document messages.

Initial messages cover only:

- Initialization, capabilities, shutdown, and host failures.
- Workspace opening, directory listing, and refresh.
- Document open/change/save/close and revision acknowledgement.
- Ordered target selection, build start, and cancellation.
- Build state, output, diagnostics, and artifact metadata.
- Host effects for dialogs and subprocesses, with completion events.

### Current Rune interfaces and compiler integration

Rune already compiles an **ordered list of source files**, uses `--lib DIR`
for its Basis Library, accepts `-o FILE`, and supports `--typecheck-only`.
`bin/rune` is the development wrapper for the self-hosted compiler and
supplies the library path. Use this compiler path for the first IDE build.
See [the architecture](../../../rune/docs/architecture.md),
[options](../../../rune/src/driver/options.sml), and [driver](../../../rune/src/driver/main.sml).

The driver is a batch compiler with mutable options, fixity, source
registries, and elaboration state. `Error.error` raises `CompileError`;
warnings are formatted strings. Do not repeatedly call `Main.main` in the
persistent service and assume sessions are isolated. Fresh compiler
processes are the M3 boundary; M5 introduces explicit compiler sessions.
[Diagnostics](../../../rune/src/util/error.sml), [positions](../../../rune/src/util/source.sml).

M3 implements structured diagnostics in an IDE-owned SML adapter, compiled
from Rune's read-only sources. It shadows final error formatting and warning
collection, then invokes the existing driver in a fresh VM. No Rune sources
were modified and no new Rune CLI flag is assumed. A future upstream
`--diagnostics-json FILE` interface could replace this adapter with permission.
Write a versioned result document to a build-specific file; ordinary output
and exit status remain unchanged. Reject missing, malformed or incompatible
reports and record the compiler build fingerprint with the packaged adapter.
The service associates the report with its ordered inputs and build identity.

A compiler diagnostic contains severity, message, optional original source
path, and optional half-open byte span. Reserve fields for related locations
and stable codes without inventing codes for every existing message.
Represent command-line, I/O, and internal failures without fictitious
locations. Preserve warning spans before formatting, including available
warnings collected before a fatal error in the machine-readable result.
A failed build may still report only the first error: recovery is M5 work.

SML associates the result with the build ID and input revisions, then
produces Problems and marker updates. Rune positions are byte offsets;
Monaco uses line/column positions in UTF-16 code units. Implement conversion
in SML against the exact text, covering CRLF, tabs, non-ASCII text, and
supplementary characters. Send editor ranges to the thin Monaco adapter.
A missing span produces a non-navigable problem rather than a guessed line.

M3 compiles saved files with ordinary CLI semantics; it does not promise
an atomic snapshot of an externally changing directory. Capture saved
document revisions at launch. Later edits invalidate affected markers and
the build's semantic result. Check relevant disk contents on completion,
label detected changes as stale, and retain the build log. M5's analysis
sessions use immutable document snapshots and overlays.

### Targets, documents, and file identity

Browsing a directory does not define a compilation unit. Never recursively
compile every `.sml` file or sort inputs alphabetically: scope and fixity
depend on file order, and repositories contain independent tests/examples.

Support a single-file target and named targets with explicit ordered input
lists. Store the small versioned configuration in `rune-ide.json` at the
workspace root: inputs, supported compiler options, and output location.
Read and validate it in SML; show the target and source order in the UI.
This is temporary IDE configuration, not Rune's future build language.
Adopt that system through an adapter when its contract exists. Do not infer
module dependencies independently in the IDE. Keep machine-specific Rune
installation paths in user settings rather than project configuration.

The initial command is **Save and Build**: synchronize document revisions,
save dirty named workspace documents, and launch only after saves succeed.
An unnamed document must be saved or excluded through a clear user action.
A failed or cancelled save stops the build. Show saving, building, success,
failure, cancelled, and stale states explicitly.

Use per-build output locations under `.rune-ide/build/`, distinct from the
compiler's planned `.rune` caches. Keep the last successful artifact separate
from failed output, publishing a new artifact only after successful exit
and result validation. An old `.rbc` must never appear to be a failed build's
new result. Compilation does not execute the program.

Centralize path identity in SML. Respect actual filesystem case sensitivity,
handle Windows drive paths, and separate display paths from document URIs.
Use one Monaco model per document identity, including split views. Do not
lowercase paths globally or identify files by basename. Show symlinks but
do not recursively follow directory links in M2; report broken links and
unreadable directories.

Editable files initially use validated UTF-8, preserving line endings and
any supported BOM. Detect binary/unsupported encodings and show an explicit
read-only or unavailable state; never save lossy replacement characters over
original bytes. Recheck disk content before overwriting externally changed
files. Rename, deletion, and moving files need coordinated conflict behavior
and come after the first release.

## Repository organization

Build the application in `/home/ruud/rune-ide`, a separate repository.
Treat `/home/ruud/rune` as a read-only toolchain and source input. Changes
there require the owner's permission. Commit after each completed milestone,
using imperative subjects with milestone labels as on Rune's master branch.
The repository layout is:

| Path | Contents |
|---|---|
| `src/sml/` | SML protocol, workspace, documents, commands, builds, diagnostics, entry point |
| `sources.txt` | Ordered service sources, following existing executable conventions |
| `src/host/`, `src/renderer/` | Electron main/preload, React adapters, styles, package manifest, lockfile |
| `tests/` | SML behavior/protocol tests and end-to-end workspace fixtures |
| `docs/ide.md` | Permanent architecture, behavior, development, packaging documentation |
| `docs/ide-protocol.md` | Permanent wire and diagnostics schemas, compatibility rules |

Share small portable utilities where diagnostics and the service both need
them, such as JSON and position conversion. Do not import the whole IDE
into the compiler bootstrap. Extend source manifests and build-generation
scripts; never hand-edit `build/`.

Proposed targets: `make service`, `make dev`, `make check`, and
`make package`. Keep Node/Electron prerequisites out of compiler-only
builds. SML service code follows Rune's portability rules and must build
with Rune and the supported host compilers; establish that loop in M1.
Packages include a compatible VM, service bytecode, compiler, and Basis,
without depending on the developer checkout or a host SML installation.
Use a platform toolchain descriptor rather than assuming a POSIX wrapper
is a Windows executable.

## Milestones

### M1. Connect a desktop shell to Standard ML

Implemented in the separate repository. Verified on Rune, MLton, Poly/ML,
SML/NJ 64-bit and 32-bit, with a packaged Electron/Playwright smoke test.
Windows/macOS packaging remains M4 work.

**Deliver:** an Electron application whose commands reach a real SML service
compiled by Rune.

- Add the service source manifest/build, JSON codec, handshake, event loop,
  host-effect interface, and clean shutdown.
- Add the pinned UI toolchain and development launcher; bundle Monaco
  workers as local assets.
- Create Explorer, editor, and bottom Problems/Output areas. A small Tree
  and Monaco fixture prove library compatibility before M2 supplies real data.
- Wire Open Folder to a native dialog and a request that reads workspace
  information in SML. Make service startup failures visible.
- Start the permanent architecture, development, and protocol documentation.

**Acceptance:** launch from a documented clean build, exchange Unicode and
embedded-newline messages, choose a folder, resize panes without breaking
Monaco, and close without orphaned children. A stopped service produces a
visible failure. Test fragmented frames, incompatible versions, and service
exit during a request. No new runtime primitive, REPL, or language server is
required for this demonstration.

### M2. Browse and edit real files

**Deliver:** a source explorer and editor usable on a Rune project.

- Implement SML workspace/path/directory models with lazy listing, stable
  directory-first ordering, and loading/empty/error states. Document default
  exclusions for generated/vendor directories and provide a Show Excluded
  option.
- Connect React Aria Tree. Arrow keys expand/navigate; activation opens a
  file. Preserve expansion/selection on refresh. Selection alone does not
  load every file encountered during keyboard navigation.
- Open Monaco tabs through Dockview, including split views of one model,
  active-file reveal, and retained selection/scroll position across tabs.
- Implement revision acknowledgements, Save/Save All, dirty indicators,
  and Save/Discard/Cancel when closing dirty documents or a workspace.
- Protect saves against partial writes with a temporary sibling and the
  platform's supported replacement operation. Preserve permissions where
  applicable; report failures without claiming unsupported durability.
- Add a small SML syntax-coloring configuration and normal find/replace.
  The tokenizer is presentation only, not another semantic parser.
- Provide Refresh and external-change checks before saving. Automatic file
  notifications are M4 work. Handle unsupported files explicitly.

**Acceptance:** browse Rune's checkout read-only; in a temporary workspace,
expand source directories, edit/save SML, split its
editor, close/reopen it, and verify the file bytes. Undo/redo survive tab
switches and layout changes. Cover duplicate basenames, spaces/Unicode in
paths, CRLF, emoji in comments/strings, symlink loops, unreadable folders,
failed writes, cancelled closes, and externally modified files. The explorer
and editor work by keyboard. A large-directory fixture verifies that opening
the tree does not recursively load the workspace.

### M3. Compile with feedback in the IDE

**Deliver:** the complete open → edit → save → compile → navigate-error loop.

- Implement ordered targets and toolchain selection. Validate paths, source
  order, Basis location, options, and output in SML. Allow one active build
  per workspace initially.
- Build/document the separate SML compiler adapter and retain default CLI
  behavior. Reject an adapter with a missing/incompatible report; do not
  scrape human error messages or modify Rune without permission.
- Implement Save and Build, cancellation, process events, and artifact
  publication. Drain both output pipes concurrently and bound retained logs.
  Distinguish source errors, launch failures, crashes, and cancellation.
- Populate Problems and Monaco markers. Activating a diagnostic opens its
  file and reveals the location; external/Basis sources may open read-only.
  Problems without source locations remain visible.
- Tag results by build and document revision. Old builds cannot clear newer
  diagnostics or replace artifacts. Markers affected by later edits become
  stale or disappear. Replace current Problems on a new result while keeping
  the build log.
- Measure save time, compiler execution, report/publication, and marker
  application. SML range conversion is currently part of compiler time.

**Acceptance:** use the actual self-hosted compiler to build a valid
multi-file program to `.rbc`; introduce a syntax error, type error, and
warning; navigate each available diagnostic; fix and rebuild. Compare the
artifact with the CLI using identical saved inputs/options. Verify that a
deliberately wrong file order fails and the correct order succeeds. Cover
non-ASCII spans, Windows-shaped paths in protocol fixtures, missing compiler
or Basis, failed save, cancellation, large output, stale results, malformed
diagnostics, and an adapter with an incompatible protocol. A crash never becomes an
empty successful Problems panel.

Document the adapter and target format here, with real-build smoke tests and
injected process failures. No checks or documentation changes in Rune are
required because this implementation does not modify its checkout. The release gate is a demonstration without a terminal:
choose a folder/target, edit, build, jump to an error, fix, and build cleanly.

### M4. Dependable editing and distribution

**Deliver:** reliable daily editing and packaged desktop builds.

Split implementation into independently committed checkpoints:

| Checkpoint | Scope | State |
|---|---|---|
| M4.1 | Session/preferences, docked layout, dirty journals, recovery and service restart | complete on Linux |
| M4.2 | File notifications, reload/conflict policy, create/rename/delete | complete on Linux |
| M4.3 | Self-contained Linux package and clean-environment build loop | complete on Linux |
| M4.4 | SML command registry/palette, keyboard/accessibility and performance gates | pending |
| M4.5 | Native Windows/macOS packages, signing/update and release validation | Windows validation via WSL2 planned; macOS testing deferred by owner |

M4.1 passes the Rune/four-host service suite and packaged Electron tests for
forced termination, explicit recovery, split/layout preferences and service
restart preserving live undo. Recovery write failures, original conflict
baselines, corrupt state, missing paths and bounded loading are covered.
See the permanent architecture/protocol documents for guarantees and limits.
M4.2 adds file notifications/fallback rescans, safe reloads, rename with undo,
workspace trash and copying missing recovery buffers. Floating/popout/edge
layout restoration and cross-OS filesystem semantics remain follow-ups. M4 as a whole is not complete.

- Add host filesystem notifications; keep refresh/reload/conflict/coalescing
  policy in SML. Rescan after notification overflow or unavailable watching.
  Add create/rename/delete with coordinated document/tree updates.
- Persist workspace, layout, and settings with schema versions. Journal
  recoverable dirty buffers separately from normal saves; offer recovery
  after a crash without overwriting source files.
- Add command palette/keybindings from the SML command registry, consistent
  themes, and accessible navigation between explorer, editor, and panels.
- Measure large trees/many tabs; add supported tree virtualization if needed
  with keyboard/accessibility checks. Dispose unused models/listeners and
  bound output/recovery storage.
- Package VM, compiler, service, assets, and Basis for Linux, Windows, and
  macOS. Verify signing/notarization and update behavior for the chosen
  distribution channels before publication.

**Acceptance:** repeat M3 from a package on a clean machine without Node or
a Rune checkout. Recover unsaved edits after forced termination. Exercise
close/build races, service restart, missing workspace paths, conflicts,
display scaling, input-method composition, and keyboard/screen-reader
navigation on supported systems. Record performance/memory on named fixtures
and hardware; set regression budgets from measurements. Use automated
Electron tests where appropriate and native checks for behavior they cannot
establish. [Electron automation][playwright].

### M5. Shared SML presentation and interactive compiler services

**Deliver:** compiler-backed editing of unsaved documents and less
handwritten frontend logic where practical. Two parts can progress separately:

1. Compile a pure presentation module with Rune and LunarML, then use the
   browser build for a real Problems or inspector view. Verify identical
   transitions/protocol fixtures, including integer/string representation
   boundaries. If successful, use shared SML for further browser-local
   application logic. Record limitations before expanding foreign bindings;
   do not duplicate service workspace/build rules in the browser.
2. Extract explicit compiler-session interfaces for snapshots, diagnostics,
   environments, and invalidation. Adopt the incremental plan's interfaces
   as they become available; retain isolated batch analysis behind the same
   contract until reuse is correct. Introduce document overlays, cancellation
   at suitable compiler boundaries, and recovery from incomplete syntax.
   Keep fresh batch compilation as a correctness oracle.

Then add hover/types, definitions, references, semantic highlighting,
completion, and symbol outlines where practical. Add rename after binding
identity and cross-file references are reliable. Expose standard features
through an SML LSP adapter and richer Rune operations through the IDE
protocol. Both use the same compiler/project model.

**Acceptance:** results describe the current unsaved snapshot; cancelled or
stale work cannot overwrite newer results. Projects cannot contaminate each
other's fixity or type state. Compare interactive/incremental results with
fresh compilation on a varied corpus, including early-file changes affecting
later inputs. Measure edit-to-result latency. Mutable annotations and
generative module identities are correctness concerns, not just cache tuning.

### M6. Execution and runtime integration

**Deliver in steps:** Run/Stop/Output first; evaluation and debugging after
their compiler/runtime contracts exist.

- Execute the selected successful artifact in a separate VM, capture output
  and status, and identify its build/source revision. Never treat an old
  artifact as the result of a failed build.
- Add structured exception traces and profiler/counter views through an
  explicit reporting adapter. Existing runtime statistics and images are
  not already a live remote-debugging protocol.
- Integrate REPL/evaluation when the incremental/REPL work provides it.
  Define environment lifetime, cancellation, and source revision for values.
- Add runtime hooks for breakpoints, stepping, frames, and paged value
  inspection, with an SML debug-adapter layer. Define object-handle validity
  across resume/GC; keep stopped execution out of the IDE process.
- Reuse tree/table widgets for values and modules. Page large collections
  and cap traversal depth instead of copying entire heaps through JSON.

**Acceptance:** loops/failures remain stoppable; editing continues while the
program pauses or crashes. Frames/values refer to the correct build. Test
tail calls, exceptions, inlining, and GC against actual runtime semantics.
Run the repository's VM, sanitizer, Windows, and portability checks when
applicable to runtime changes, as required by `AGENTS.md`.

Saved worlds may support later session persistence; they do not themselves
implement reverse execution or replay of external I/O. Those remain separate
investigations. See [runtime behavior](../../../rune/docs/runtime.md).

### M7. Deeper tools and product quality

Add source-linked IR/pass viewers, module/type exploration, profiling
comparisons, structured refactorings, test navigation, and documentation
browsing as SML service models become available. Prefer reusable views to
feature-specific JavaScript implementations of semantic logic. Define an
extension API after internal features establish stable contribution
boundaries. VS Code extension compatibility is not an implicit requirement.

For each feature specify a user-visible operation, correctness fixture,
SML ownership, required adapter code, and measured interactive budget.
Measure bottlenecks before considering another desktop shell. A contained
Electron adapter can be replaced; replacing the whole workbench or editor
would be a larger project.

## Verification and completion

- Test domain behavior in SML: paths, ordering, revisions, saves, build
  transitions, diagnostics, stale-result rejection. Share wire fixtures with
  TypeScript boundary tests. Avoid duplicating widget-library tests.
- Keep real end-to-end programs for success, warnings, syntax/type errors,
  ordered files, non-ASCII text, and external edits. Inject failed writes,
  missing/malformed diagnostics, broken transport, and process crashes.
- Measure large directories/many documents and verify that closing tabs or
  finishing builds releases resources. Compiler speed and UI responsiveness
  are separate measurements.
- Run this repository's `make check`, cross-host SML checks, and packaged UI
  tests. Do not run mutation-producing builds or tests in the Rune checkout.
  If compiler/runtime changes are needed, prepare and test them outside it
  and obtain permission before applying them there.
  Add dedicated IDE prerequisites/checks without requiring Electron for
  compiler-only builds.
- Every implemented milestone updates `docs/ide.md`, `docs/ide-protocol.md`,
  or the relevant compiler/runtime documentation. Move lasting contracts
  there before retiring this temporary roadmap. Update milestone status
  with evidence and remaining limitations after each implementation session.

## Relation to other work

The [incremental compilation plan](../../../rune/docs/plans/incremental-compilation.md) owns compiler
caching, REPL, dynamic modules, and the future build language. This roadmap
owns the IDE and adapters to those facilities. M3 uses today's ordered batch
inputs; M5 adopts stable session interfaces rather than inventing a second
compiler cache or module system.

The [JIT plan](../../../rune/docs/plans/jit.md), [compiler architecture](../../../rune/docs/architecture.md), and
[runtime documentation](../../../rune/docs/runtime.md) define execution and representation
contracts. Debugging must preserve their invariants. Browser concepts do
not belong in compiler IRs or the VM. Native FFI, other desktop shells,
package management, remote workspaces, collaboration, and time-travel
debugging can be separate follow-ups after the first useful IDE.

M1–M3 now provide the first working editing/compilation loop on Linux. M4.1 adds recovery and session restoration. The
remaining M4 gates include the command registry, accessibility/performance measurements and native Windows distribution. M5 and later milestones remain future work.

## External references

Primary documentation checked on 2026-09-25. Pin and verify actual versions
in M1; these references do not establish a tested Rune package combination.

[electron-process]: https://www.electronjs.org/docs/latest/tutorial/process-model
[electron-isolation]: https://www.electronjs.org/docs/latest/tutorial/context-isolation
[electron-ipc]: https://www.electronjs.org/docs/latest/tutorial/ipc
[dockview]: https://dockview.dev/docs/overview/introduction/
[monaco]: https://github.com/microsoft/monaco-editor
[aria-tree]: https://react-aria.adobe.com/Tree
[aria-start]: https://react-aria.adobe.com/getting-started
[lunarml]: https://github.com/minoki/LunarML
[lunar-js]: https://lunarml.readthedocs.io/en/latest/javascript.html
[playwright]: https://playwright.dev/docs/api/class-electron
[forge-template]: https://www.electronforge.io/templates/typescript-+-webpack-template
[forge-vite]: https://www.electronforge.io/config/plugins/vite
[json-rpc]: https://www.jsonrpc.org/specification

- [Electron packaging with Forge](https://www.electronforge.io/).
- [Monaco language-client integration](https://github.com/TypeFox/monaco-languageclient).
