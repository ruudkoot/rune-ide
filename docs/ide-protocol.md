# IDE service protocol, version 1

The service consumes UTF-8 JSON-RPC 2.0 requests, one per line. LF and CRLF
are accepted; embedded newlines are JSON escapes. Requests have `jsonrpc`,
`id`, `method`, and `params`; each receives either `result` or an error with
`code` and `message`. Notifications and batch requests are not supported.
stdout contains only protocol messages; stderr is for logs. Maximum input
frame size is 4 MiB, with a nesting limit of 128; oversized input terminates
the service after an error so an incomplete frame cannot be reinterpreted.
The host also bounds request/response sizes and request wait time.

| Method | Parameters | Result |
|---|---|---|
| `initialize` | `{protocol: 1, stateDir?: string, defaultToolchain?: string}` | `{protocol: 1, implementation: string}` |
| `ping` | Any JSON value | Same value |
| `workspace/open` | `{path: string}` | Canonical workspace `{path, name}` |
| `workspace/list` | `{path: string, showExcluded?: boolean}` | Entries `{path, name, directory, symlink}[]` |
| `shutdown` | `{}` | `null`, followed by clean exit |

Initialize before sending other methods. Incompatible protocol is `-32001`,
missing initialization `-32002`, workspace policy failure `-32010`, unknown
method `-32601`, invalid parameters `-32602`, malformed JSON `-32700`, and
I/O/service failures `-32000`. Invalid JSON does not destroy the session;
the next complete request is still processed. Error responses to malformed
JSON use a null ID. Duplicate JSON object keys and invalid Unicode scalars
are rejected.

Electron main owns initialize/shutdown. The preload exposes only approved
application requests, folder selection, and service status subscriptions;
the renderer cannot request arbitrary processes or raw IPC channels. Request
IDs and transport sequencing are host details. SML returns the domain data.

## Documents (M2)

| Method | Parameters | Result |
|---|---|---|
| `document/open` | `{path}` | `{path, text, savedText, bom, revision, dirty}` |
| `document/change` | `{path, revision, changes: [{offset, length, text}]}` | `{path, revision, dirty}` |
| `document/save` | `{path, revision}` | Document snapshot, including `savedText` |
| `document/close` | `{path, revision, discard?: boolean}` | `null` |
| `document/list` | `{}` | `{path, revision, dirty}[]` |

Open returns the canonical path, BOM-free text and revision 0 on first load;
opening it again returns the current buffer. Revisions increment on accepted
changes. Edit offsets and lengths count UTF-16 units in the old document,
including CRLF as two units. Changes may arrive in any order, must not overlap,
and cannot split a surrogate pair. A rejected batch leaves text/revision intact.

Save requires the acknowledged revision and unchanged disk bytes. Close rejects
dirty documents unless `discard` is true. Workspace changes reject unsaved
buffers. Document policy errors use `-32020`; filesystem errors use `-32000`.
The renderer serializes edits/saves per document and retains its buffer after
errors. A UI unsaved indicator can be optimistic while an edit is in flight.

## Builds (M3)

| Method | Parameters | Result |
|---|---|---|
| `build/targets` | `{activePath?: string}` | `{name, sources: string[], output}[]` |
| `build/prepare` | `{target, activePath?, toolchain, compiler}` | `{id, executable, args, cwd, target}` |
| `build/finish` | `{id, exitCode: number or null, cancelled?, failure?}` | `{id, state, diagnostics, output, sources}` |
| `diagnostic/open` | `{index}` | Document snapshot; external sources add `readOnly: true` |

Only Electron main can call prepare/finish; they are not on the renderer's
request allowlist. The renderer can start/cancel a build through dedicated
preload methods and subscribe to bounded log/status updates. Preparation
validates the ordered sources, toolchain, Basis, output and saved documents in
SML. Workspace changes and overlapping builds are rejected until completion.
`-32030` denotes build policy errors. A completion with the wrong ID cannot
finish the active build.

Result states are `success`, `failed`, `cancelled`, or `stale`. Diagnostics have
`severity` (`error` or `warning`), `message`, `path`, and a nullable Monaco-shaped
range with 1-based UTF-16 line/columns. Paths are JSON strings, never parsed from
human diagnostics; Windows-shaped paths survive transport unchanged. Original
byte spans remain in the compiler's report file. A missing location stays
visible without an invented position. External source access is restricted to
a diagnostic in the latest result and opens read-only.

The adapter writes `{version: 1, success, compilerVersion, diagnostics}` to its
unique report path. The service compares success with the child exit code,
validates ranges, and rejects missing or incompatible reports. An ordinary Rune
CLI bytecode file cannot silently substitute for this adapter. Failed builds
with no source diagnostic receive a generic problem pointing to Output. Only a
successful result with unchanged saved inputs publishes the candidate artifact.

## Sessions and recovery (M4.1)

The host optionally supplies `stateDir` at initialization. Omitting it keeps
persistence disabled for isolated service use. Initialization is accepted once.
Session policy errors use `-32040`; OS failures remain `-32000`.

| Method | Parameters | Result |
|---|---|---|
| `session/load` | `{}` | `{version: 1, workspace, view, settings, recovery, warnings}` |
| `session/save` | `{workspace?, view, settings}` | `null` |
| `session/toolchain` | `{path}` | `null` (host only) |
| `session/end` | `{}` | `null` (host only, after accepted quit) |
| `recovery/restore` | `{id}` | Document snapshot, revision 0 |
| `recovery/discard` | `{id}` | `null` |
| `document/attach` | `{path, text, savedText, bom}` | Document snapshot, revision 0 |

`workspace` is a canonical root or null. `view` is null or a version-1 opaque
renderer object (at most 256 KiB). `settings` contains optional/null `target`,
`toolchain`, and `showExcluded`. The host supplies `defaultToolchain` at
initialization; saving that exact path stores null, so the bundled toolchain
follows a relocated package. Explicit external toolchains keep their paths.
A supplied workspace in `session/save` must
match the current session. `recovery` lists pending records as
`{id, workspace, path, revision}`; warnings are strings. No journal text is
included in this list. Unknown versions are rejected/preserved rather than
silently migrated.

With persistence enabled, document changes are journalled before revision
acknowledgement. A pending record blocks ordinary `document/open` for that
path until restored or discarded. Restore requires its original workspace
and path; it keeps the saved baseline for future conflict checks. Discard
accepts only pending records, not journals already attached to live editors.
`document/attach` reconnects an existing renderer model after service restart,
validates/journals its current text and baseline, and retires any pending offer
for that path. The renderer must freeze edits while attaching models.

The host calls `session/end` only after the renderer completes its close
prompts. It removes active journals, leaving unhandled recovery offers intact.
`shutdown` by itself never clears journals. See architecture documentation for
storage limits, atomic-write behavior and missing-path handling.

## Filesystem changes and mutations (M4.2)

| Method | Parameters | Result |
|---|---|---|
| `workspace/watch` | `{paths: string[], showExcluded?: boolean}` | Canonical directories (host only) |
| `workspace/changes` | `{}` | `{root, directories: [{path, entries, error?}]}` |
| `document/check` | `{path, revision}` | `{state, revision}` |
| `document/reload` | `{path, revision, discard?: boolean}` | Document snapshot, incremented revision |
| `file/create` | `{parent, name, directory?: boolean}` | `{path, directory}` |
| `file/rename` | `{path, name}` | `{oldPath, path}` |
| `file/delete` | `{path}` | `{path, trashPath}` |
| `file/copy` | `{parent, name, path, revision}` or `{parent, name, recoveryId}` | `{path}` |

The dedicated preload watch method passes the requested subscription through
SML validation before installing native watchers. Notifications carry no
assumed filesystem result: the renderer requests a scan. Disk states are
`same`, `changed`, `missing`, `unreadable` or `replaced`. Checking a missing
file retains a recovery record even when its text equals the saved baseline.
Reload rejects dirty buffers unless discard is explicit, validates the current
disk bytes and never overwrites them. The renderer serializes it with edits
and freezes the affected editor while applying the returned snapshot.

File policy errors use `-32050`. Mutations reject active builds, conflicting or
unsaved affected documents, pending recovery buffers, protected roots and
existing destinations. Rename preserves document revisions and remaps path
prefixes in SML. Delete moves content into workspace trash and removes its
active document records. Copy writes new content exclusively and retains the
original record. See the architecture document for limitations and retention.
