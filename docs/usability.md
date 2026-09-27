# Commands, accessibility and performance

The SML command registry owns command IDs, labels, categories, default
shortcuts, availability rules and case-insensitive search by all query words.
Electron builds its native menus from these records; the renderer dispatches
IDs and supplies presentation context. File/build requests still enforce their
own SML rules. The renderer handles workbench keys before Monaco and ignores
composition events, repeated keys and keys within a dialog.

Use **Ctrl+Shift+P** (Cmd on macOS) or **Commands** to open the palette. Enter
runs the first available result; Down moves into the React Aria listbox,
where arrows and Enter select a command. Escape cancels and restores focus.
Focus commands reach Explorer (Ctrl+Shift+E), Editor (Ctrl+1), Output
(Ctrl+Shift+U) and Problems (Ctrl+Shift+M). The registry also includes saves,
build/cancel, split/reveal/close, Close All Editors, zoom and three color themes.
Themes persist in the SML session, including before a workspace is opened.

Dark, light and high-contrast themes use shared widget/dock/panel colors and
matching Monaco themes. Toolbar rows wrap under zoom or narrow windows.
Keyboard tests cover palette filtering/execution, focus changes, virtual tree
Home/End navigation, theme persistence and 150% zoom. This is not a claim of
completed native screen-reader or input-method validation; those checks remain
release gates. Native macOS testing is explicitly deferred by the owner.

The explorer uses React Aria's `Virtualizer` with `ListLayout`: the installed
Tree implementation supplies its flattened expanded collection and ARIA row
positions. Only visible/overscan rows mount in the DOM. Lazy directory loading,
selection, nested arrow navigation and placeholders remain unchanged. The
performance fixture asserts fewer than 200 DOM rows for 5,000 sibling files.

Inactive tabs keep one Monaco text model and undo history per document but
unmount their editor widget. Splits share the model; closing the last view
releases its model/subscription. SML refuses more than 128 open documents
without evicting existing text. Recovery is separately limited to 64 records
and 16 MiB, watch subscriptions to 128 directories, and compiler output to
128 Ki characters. The workspace trash has no automatic purge.

The repeatable fixture in `tests/ui/usability.spec.ts` creates 5,000 small SML
files, opens 64 tabs and closes them all. It records listing/display/tab/close
times, CPU/memory details, and renderer JavaScript heap after forced GC in
`test-results/performance.json`. These are measurements of the packaged
application on WSL2, not system-wide RSS or a promise for all machines. The
fixture checks document counts and widget disposal as well as timing/memory.

Recorded on 2026-09-27, WSL2 on an Intel Xeon E5-1680 v3 @ 3.20 GHz,
31.3 GiB guest RAM: tree display 1,005 ms; direct SML/IPC listing 863 ms;
64 tabs opened through Playwright in 69,729 ms; all closed in 5,649 ms.
Post-GC renderer heap was 17.0 MiB initially, 78.6 MiB with tree/tabs, and
56.0 MiB after closing (the 5,000-file tree remains loaded). The bulk-tab
time includes selection, scrolling, keyboard input and automation waits;
it is not a measurement of isolated editor-open latency. Profiling still
finds React Aria's per-row sibling counting significant for huge directories.

Initial regression budgets: tree display 15 s, listing 5 s, 64 automated tab
opens 120 s, incremental renderer heap below 512 MiB; after close, no editor
widgets or service documents and no heap growth beyond 8 MiB over the peak.
These deliberately allow machine/load variation; tightening latency and
retained-heap budgets remains measured M7 work.
