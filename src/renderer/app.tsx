import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Checkbox, Virtualizer, ListLayout, Tree, TreeItem, TreeItemContent, Collection, Key, ModalOverlay, Modal, Dialog, Heading, TextField, Label, Input } from 'react-aria-components';
import { DockviewReact, DockviewReadyEvent, IDockviewPanelProps } from 'dockview-react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js';
import { BuildStatus, BuildTarget, Command, CommandInfo, CommandContext, Theme, DirectoryEntry, DocumentSnapshot, RecoveryBuffer, ServiceStatus, SessionState, Workspace, WorkspaceChanges } from '../shared/protocol';
import { CommandPalette } from './command-palette';
import { EditorLayout, EditorStore } from './editor-store';
import './sml-language';
import 'dockview-react/dist/styles/dockview.css';
import './style.css';

monaco.editor.defineTheme('rune', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#171a1f', 'editorLineNumber.foreground': '#535d6c', 'editorCursor.foreground': '#9bd3b3', 'editor.selectionBackground': '#34483f' } });
type Context = {
  workspace: Workspace | null; entries: Map<string, DirectoryEntry[]>; expanded: Set<Key>; selected: Set<Key>;
  expand: (keys: Set<Key>) => void; select: (keys: Set<Key>) => void; refresh: () => void;
  error: string; openFolder: () => void; store: EditorStore; showExcluded: boolean; toggleExcluded: (show: boolean) => void;
  build: BuildStatus;
  saveCopy: (path: string, recoveryId?: string) => void;
  fileAction: (kind: 'file' | 'folder' | 'rename' | 'delete') => void;
};
const Workbench = createContext<Context>(null!);

const SourceTree = React.memo(function SourceTree(state: Pick<Context, 'workspace' | 'entries' | 'expanded' | 'selected' | 'select' | 'expand' | 'store'>) {
  const render = useCallback(function render(entry: DirectoryEntry): React.ReactElement { return <TreeItem key={entry.path} id={entry.path} textValue={entry.name} hasChildItems={entry.directory && !entry.symlink}
    onAction={() => { if (!entry.directory) state.store.run(state.store.open(entry.path)); }}>
    <TreeItemContent>{({ isExpanded }) => <>{entry.directory && !entry.symlink ? <Button slot="chevron" className="chevron">{isExpanded ? '⌄' : '›'}</Button> : <span className="chevron"/>}<span className={entry.directory ? 'folder-icon' : 'file-icon'}>{entry.directory ? '▱' : 'λ'}</span><span>{entry.name}</span>{entry.symlink && <span className="muted"> ↗</span>}</>}</TreeItemContent>
    <Collection dependencies={[state.entries]} items={state.entries.get(entry.path) || []}>{render}</Collection>
    {entry.directory && !entry.symlink && !state.entries.get(entry.path)?.length && <TreeItem id={`${entry.path}/:placeholder`} textValue="Directory status" isDisabled><TreeItemContent><span className="muted">{state.entries.has(entry.path) ? 'Empty folder' : 'Loading…'}</span></TreeItemContent></TreeItem>}
  </TreeItem>; }, [state.entries, state.store]);
  return <Virtualizer layout={ListLayout} layoutOptions={{ rowHeight: 28 }}><Tree dependencies={[state.entries]} aria-label="Source files" selectionMode="single" selectionBehavior="replace" selectedKeys={state.selected} onSelectionChange={keys => state.select(keys as Set<Key>)} expandedKeys={state.expanded} onExpandedChange={state.expand} items={state.entries.get(state.workspace!.path) || []}>{render}</Tree></Virtualizer>;
});

function Explorer() {
  const state = useContext(Workbench);
  return <section className="explorer">
    <div className="panel-tools"><span>{state.workspace?.name || 'WORKSPACE'}</span><Button aria-label="Refresh file tree" onPress={state.refresh} isDisabled={!state.workspace}>↻</Button></div>
    {state.workspace && <div className="file-tools">
      <Button aria-label="New file" onPress={() => state.fileAction('file')}>+ File</Button>
      <Button aria-label="New folder" onPress={() => state.fileAction('folder')}>+ Folder</Button>
      <Button onPress={() => state.fileAction('rename')} isDisabled={!state.selected.size}>Rename</Button>
      <Button aria-label="Move to trash" onPress={() => state.fileAction('delete')} isDisabled={!state.selected.size}>Trash</Button>
    </div>}
    {state.workspace ? <><Checkbox className="excluded-toggle" isSelected={state.showExcluded} onChange={state.toggleExcluded}><span className="check-box"/>Show excluded files</Checkbox>
      <SourceTree workspace={state.workspace} entries={state.entries} expanded={state.expanded} selected={state.selected} select={state.select} expand={state.expand} store={state.store} /></>
      : <div className="empty"><p>Bring your sources<br/>into focus.</p><Button className="primary" onPress={state.openFolder}>Open folder</Button><small>Open a file with Enter or a double click.</small></div>}
  </section>;
}
const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = { fontSize: 14, fontFamily: '"DejaVu Sans Mono", monospace', minimap: { enabled: false }, automaticLayout: true, padding: { top: 18 }, scrollBeyondLastLine: false };
function WelcomeEditor() {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = monaco.editor.create(element.current!, { ...editorOptions, value: '(* Welcome to Rune. *)\n\n(* Open a folder, then double-click a source file\n   or select it and press Enter. *)\n\nstructure Hello =\nstruct\n  val greeting = "Hello, Rune"\nend\n', language: 'sml', readOnly: true });
    return () => { editor.getModel()?.dispose(); editor.dispose(); };
  }, []);
  return <div ref={element} className="editor" aria-label="Welcome editor" />;
}
function EditorPanel(props: IDockviewPanelProps<{ path: string }>) {
  const { store, saveCopy } = useContext(Workbench);
  const element = useRef<HTMLDivElement>(null);
  const doc = store.documents.get(props.params.path);
  useEffect(() => {
    if (!doc) return;
    const editor = monaco.editor.create(element.current!, { ...editorOptions, model: doc.model, readOnly: doc.readOnly || store.suspended, ariaLabel: `Source editor ${props.params.path}` });
    const view = store.viewStates.get(props.api.id); if (view) editor.restoreViewState(view);
    store.editors.set(props.api.id, editor);
    const range = store.revealRanges.get(props.params.path);
    if (range) { editor.setSelection(range); editor.revealRangeInCenter(range); store.revealRanges.delete(props.params.path); }
    const focus = editor.onDidFocusEditorWidget(() => props.api.setActive());
    const cursor = editor.onDidChangeCursorPosition(() => store.sessionChanged());
    const scroll = editor.onDidScrollChange(() => store.sessionChanged());
    const active = props.api.onDidActiveChange(({ isActive }) => { if (isActive) editor.focus(); });
    if (props.api.isActive) editor.focus();
    return () => { const view = editor.saveViewState(); if (view) store.viewStates.set(props.api.id, view); store.editors.delete(props.api.id); focus.dispose(); cursor.dispose(); scroll.dispose(); active.dispose(); editor.dispose(); };
  }, [props.params.path, props.api, store, doc]);
  if (!doc) return <div className="empty"><p>This file has recoverable edits.</p><span>Use the recovery banner to restore or discard them.</span></div>;
  return <div className="editor-pane">
    {doc.diskState !== 'same' && <div className="disk-banner" role="status">
      <span>{doc.diskState === 'missing' ? 'This file was removed from disk. Its text is still open.' : 'The file changed on disk. Your editor text has been retained.'}</span>
      <Button onPress={() => saveCopy(doc.state.path)}>Save a copy</Button>
      <Button onPress={() => store.run(store.reload(doc))} isDisabled={doc.diskState === 'missing' || doc.diskState === 'unreadable'}>Reload from disk</Button>
    </div>}
    <div ref={element} className="editor" data-document={props.params.path} />
  </div>;
}
function DocumentTab(props: IDockviewPanelProps<{ path: string }>) {
  const { store } = useContext(Workbench);
  return <div className="document-tab" title={props.params.path}><span>{props.api.title}</span><Button aria-label={`Close ${props.api.title}`} onPointerDown={e => e.stopPropagation()} onPress={() => store.run(store.close(store.api.getPanel(props.api.id)))}>×</Button></div>;
}
function FixedTab(props: IDockviewPanelProps) { return <div className="fixed-tab">{props.api.title}</div>; }
function Output() {
  const { error, build } = useContext(Workbench);
  const element = useRef<HTMLDivElement>(null);
  const height = useRef(0);
  useEffect(() => {
    const box = element.current!;
    if (box.scrollTop + box.clientHeight >= height.current - 20) box.scrollTop = box.scrollHeight;
    height.current = box.scrollHeight;
  }, [build.log]);
  return <div ref={element} className="output" tabIndex={-1} aria-label="Build output">{error && <p className="error" role="alert">{error}</p>}
    {build.log ? <pre>{build.log}</pre> : <><p className="output-line"><span className="good">●</span> Workbench ready</p><p className="muted">Enter opens a file · Ctrl+S saves · Ctrl+Shift+B builds</p></>}
  </div>;
}
function Problems() {
  const { build, store } = useContext(Workbench);
  return <div className="problems" tabIndex={-1} aria-label="Problems">
    <div className="problem-summary">{build.state === 'idle' ? 'Build to check your sources.' : 'Build ' + build.state + ' · ' + build.diagnostics.length + ' problems'}</div>
    {build.diagnostics.map((d, i) => <Button key={i} className={'problem-row ' + d.severity} isDisabled={!d.path || !d.range}
      onPress={() => store.run(store.navigate(d, i))}>
      <span className="problem-severity">{d.severity === 'error' ? '×' : '△'}</span>
      <span className="problem-message">{d.message}</span>
      <span className="problem-location">{d.path ? d.path.slice(d.path.lastIndexOf('/') + 1) : ''}{d.range ? ':' + d.range.startLineNumber + ':' + d.range.startColumn : ''}</span>
      {(build.state === 'stale' || store.stalePaths.has(d.path)) && <span className="muted">out of date</span>}
    </Button>)}
  </div>;
}
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const [entries, setEntries] = useState(new Map<string, DirectoryEntry[]>());
  const [expanded, setExpanded] = useState(new Set<Key>());
  const [selected, setSelected] = useState(new Set<Key>());
  const [theme, setTheme] = useState<Theme>('dark');
  const [palette, setPalette] = useState(false);
  const [commandRows, setCommandRows] = useState<CommandInfo[]>([]);
  useEffect(() => { document.documentElement.dataset.theme = theme; monaco.editor.setTheme(theme === 'dark' ? 'rune' : theme === 'light' ? 'vs' : 'hc-black'); }, [theme]);
  const [showExcluded, setShowExcluded] = useState(false);
  const [status, setStatus] = useState<ServiceStatus>({ state: 'starting', message: 'Starting service…' });
  const [error, setError] = useState('');
  const [build, setBuild] = useState<BuildStatus>({ id: null, state: 'idle', diagnostics: [], sources: [], output: null, log: '', elapsedMs: 0, finishMs: 0 });
  const [targets, setTargets] = useState<BuildTarget[]>([]);
  const [target, setTarget] = useState('');
  const [toolchain, setToolchain] = useState('');
  const [savingBuild, setSavingBuild] = useState(false);
  const [saveMs, setSaveMs] = useState(0);
  const [markerMs, setMarkerMs] = useState(0);
  const [layoutReady, setLayoutReady] = useState(false);
  const [restored, setRestored] = useState(false);
  const [recovery, setRecovery] = useState<RecoveryBuffer[]>([]);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [discardRecovery, setDiscardRecovery] = useState<string | null>(null);
  const [reconnecting, setReconnecting] = useState(false);
  const [fileDialog, setFileDialog] = useState<{ kind: 'file' | 'folder' | 'rename' | 'delete' | 'copy'; path: string; name: string; source?: string; recoveryId?: string } | null>(null);
  const [fileError, setFileError] = useState('');
  const [fileBusy, setFileBusy] = useState(false);
  const scan = useRef<() => Promise<void>>(async () => {});
  const scanning = useRef(false);
  const booted = useRef(false);
  const restoredRef = useRef(false);
  const sessionTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const persistSession = useRef<() => Promise<void>>(async () => {});
  const [, redraw] = useState(0);
  const [store] = useState(() => new EditorStore(() => redraw(n => n + 1), e => { setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': Error: /, '')); store?.api?.getPanel('output')?.api.setActive(); }));
  useEffect(() => { if (status.state === 'ready') store.run(window.rune.request<CommandInfo[]>('commands/list').then(setCommandRows)); }, [status.state]);
  const closing = useRef(false);
  const activePath = store.active()?.state.path;
  const busyBuild = savingBuild || build.state === 'running';
  const watchPaths = [...new Set([workspace?.path, ...Array.from(expanded, String), ...[...store.documents.values()].filter(d => !d.readOnly).map(d => d.state.path.slice(0, d.state.path.lastIndexOf('/')))].filter((p): p is string => !!p))];
  const watchKey = JSON.stringify(watchPaths);
  useEffect(() => {
    if (workspace && restored && status.state === 'ready' && !reconnecting) store.run(window.rune.watch(watchPaths, showExcluded));
  }, [watchKey, showExcluded, restored, status.state, reconnecting]);
  scan.current = async () => {
    if (!workspace || !restored || status.state !== 'ready' || store.suspended || scanning.current) return;
    const root = workspace.path;
    scanning.current = true;
    try {
      const result = await window.rune.request<WorkspaceChanges>('workspace/changes');
      if (workspaceRef.current?.path !== root || result.root !== root) return;
      if (result.directories.length) setEntries(previous => {
        const next = new Map(previous);
        for (const row of result.directories) next.set(row.path, row.entries);
        return next;
      });
      await store.inspectDocuments();
    } finally { scanning.current = false; }
  };
  useEffect(() => window.rune.onFilesChanged(() => store.run(scan.current())), [store]);
  persistSession.current = async () => {
    if (!restoredRef.current || status.state !== 'ready') return;
    await window.rune.request('session/save', {
      workspace: workspace?.path || null,
      view: store.capture(Array.from(expanded, String), Array.from(selected, String)),
      settings: { showExcluded, target, toolchain, theme },
    });
  };
  const scheduleSession = () => {
    clearTimeout(sessionTimer.current);
    if (restoredRef.current) sessionTimer.current = setTimeout(() => store.run(persistSession.current()), 400);
  };
  store.sessionChanged = scheduleSession;
  useEffect(() => { scheduleSession(); }, [workspace, expanded, selected, showExcluded, target, toolchain, theme, restored]);
  useEffect(() => () => clearTimeout(sessionTimer.current), []);
  useEffect(() => { if (status.state === 'failed') store.suspend(true); }, [status.state, store]);
  useEffect(() => {
    if (!layoutReady || status.state !== 'ready' || booted.current) return;
    booted.current = true; store.suspend(true);
    store.run((async () => {
      try {
        const session = await window.rune.request<SessionState>('session/load');
        setRecovery(session.recovery);
        setTheme(session.settings.theme || 'dark');
        setShowExcluded(!!session.settings.showExcluded);
        setTarget(session.settings.target || '');
        if (session.warnings.length) setError(session.warnings.join('\n'));
        if (session.workspace) {
          const ws = await window.rune.request<Workspace>('workspace/open', { path: session.workspace });
          workspaceRef.current = ws; store.root = ws.path; setWorkspace(ws);
          await load(ws.path, !!session.settings.showExcluded);
          const view = session.view as EditorLayout | null;
          const directories = (view?.expanded || []).filter(p => p.startsWith(ws.path + '/'));
          for (const path of directories) {
            try { await load(path, !!session.settings.showExcluded); } catch { /* A folder may have disappeared. */ }
          }
          setExpanded(new Set(directories)); setSelected(new Set(view?.selected || []));
          await store.restore(session.view, session.recovery.map(d => d.path));
        }
      } finally { restoredRef.current = true; setRestored(true); store.suspend(false); }
    })());
  }, [layoutReady, status.state, store]);
  useEffect(() => {
    store.run(window.rune.toolchain().then(setToolchain));
    void window.rune.buildStatus().then(setBuild);
    return window.rune.onBuild(value => {
      const start = performance.now(); store.applyBuild(value); setMarkerMs(performance.now() - start); setBuild(value);
      if (value.state === 'failed' && value.diagnostics.length) store.api?.getPanel('problems')?.api.setActive();
    });
  }, [store]);
  useEffect(() => {
    if (!workspace) return;
    let current = true;
    store.run(window.rune.request<BuildTarget[]>('build/targets', { activePath }).then(rows => {
      if (current) { setTargets(rows); setTarget(previous => rows.some(t => t.name === previous) ? previous : rows[0]?.name || ''); }
    }));
    return () => { current = false; };
  }, [workspace, activePath, store]);
  useEffect(() => { void window.rune.status().then(setStatus); return window.rune.onStatus(setStatus); }, []);
  const load = useCallback(async (path: string, excluded = showExcluded) => {
    const ws = workspaceRef.current;
    const rows = await window.rune.request<DirectoryEntry[]>('workspace/list', { path, showExcluded: excluded });
    if (workspaceRef.current === ws) setEntries(previous => new Map(previous).set(path, rows));
  }, [showExcluded]);
  const openFolder = () => store.run((async () => {
    if (!restored) return;
    if (busyBuild) throw new Error('Finish or cancel the active build before changing workspace');
    const path = await window.rune.chooseFolder(); if (!path || closing.current) return;
    closing.current = true;
    store.suspend(true);
    try {
      if (!await store.prepareAll()) return;
      clearTimeout(sessionTimer.current); await persistSession.current();
      await store.clear();
      const ws = await window.rune.request<Workspace>('workspace/open', { path });
      workspaceRef.current = ws; store.root = ws.path;
      setWorkspace(ws); setEntries(new Map()); setExpanded(new Set()); setSelected(new Set()); setError(''); await load(ws.path);
    } finally { closing.current = false; store.suspend(status.state !== 'ready'); }
  })());
  const recoverBuffer = async (buffer: RecoveryBuffer, discard = false) => {
    if (recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      if (discard) {
        await window.rune.request('recovery/discard', { id: buffer.id });
        setDiscardRecovery(null);
        // Replace any recovery placeholder with the current disk version.
        if (buffer.workspace === store.root && store.panels(buffer.path).length) await store.open(buffer.path);
      } else {
        if (buffer.workspace !== store.root) {
          if (workspace) throw new Error('Open ' + buffer.workspace + ' before restoring this buffer');
          const ws = await window.rune.request<Workspace>('workspace/open', { path: buffer.workspace });
          workspaceRef.current = ws; store.root = ws.path; setWorkspace(ws); await load(ws.path);
        }
        const snapshot = await window.rune.request<DocumentSnapshot>('recovery/restore', { id: buffer.id });
        await store.open(snapshot.path, false, snapshot);
      }
    } finally {
      try {
        const session = await window.rune.request<SessionState>('session/load');
        setRecovery(session.recovery);
      } finally { setRecoveryBusy(false); }
    }
  };
  const restartService = async () => {
    if (reconnecting || busyBuild) return;
    setReconnecting(true); store.suspend(true);
    try {
      await window.rune.restartService(); await store.reconnect();
      const session = await window.rune.request<SessionState>('session/load'); setRecovery(session.recovery);
      setError(''); store.suspend(false);
    } finally { setReconnecting(false); }
  };
  const refresh = (excluded = showExcluded) => {
    setError('');
    if (workspace) for (const path of [workspace.path, ...Array.from(expanded, String)]) store.run(load(path, excluded));
    store.run(store.inspectDocuments());
  };
  const fileAction = (kind: 'file' | 'folder' | 'rename' | 'delete') => {
    if (!workspace || busyBuild) return;
    const selectedPath = String([...selected][0] || workspace.path);
    const entry = [...entries.values()].flat().find(e => e.path === selectedPath);
    const parent = !entry || entry.directory ? selectedPath : selectedPath.slice(0, selectedPath.lastIndexOf('/'));
    setFileError(''); setFileDialog({ kind, path: kind === 'file' || kind === 'folder' ? parent : selectedPath, name: kind === 'rename' ? entry?.name || '' : '' });
  };
  const saveCopy = (path: string, recoveryId?: string) => {
    if (!workspace) { setError('Open a destination folder before saving a recovery copy.'); return; }
    setFileError(''); setFileDialog({ kind: 'copy', path: workspace.path, name: path.slice(path.lastIndexOf('/') + 1) + '.copy', source: path, recoveryId });
  };
  const mutateFile = async () => {
    if (!fileDialog || fileBusy || busyBuild) return;
    setFileBusy(true); setFileError(''); closing.current = true; store.suspend(true);
    try {
      await store.settle();
      const { kind, path, name } = fileDialog;
      if (kind === 'rename') {
        const result = await window.rune.request<{ oldPath: string; path: string }>('file/rename', { path, name });
        store.rename(result.oldPath, result.path);
        setExpanded(keys => new Set([...keys].map(k => String(k) === path || String(k).startsWith(path + '/') ? result.path + String(k).slice(path.length) : k)));
        setSelected(new Set([result.path]));
      } else if (kind === 'delete') {
        await window.rune.request('file/delete', { path }); store.removed(path);
        setExpanded(keys => new Set([...keys].filter(k => String(k) !== path && !String(k).startsWith(path + '/')))); setSelected(new Set());
      } else if (kind === 'copy') {
        const doc = fileDialog.source ? store.documents.get(fileDialog.source) : undefined;
        const result = await window.rune.request<{ path: string }>('file/copy', { parent: path, name, path: fileDialog.source, revision: doc?.state.revision, recoveryId: fileDialog.recoveryId });
        await store.open(result.path); setSelected(new Set([result.path]));
      } else {
        const result = await window.rune.request<{ path: string }>('file/create', { parent: path, name, directory: kind === 'folder' });
        setExpanded(keys => new Set([...keys, path])); setSelected(new Set([result.path]));
        if (kind === 'file') await store.open(result.path);
      }
      setFileDialog(null); setEntries(new Map());
      if (workspace) await load(workspace.path);
    } catch (error) { setFileError((error as Error).message); }
    finally { setFileBusy(false); closing.current = false; store.suspend(status.state !== 'ready'); }
  };
  const expand = useCallback((keys: Set<Key>) => { setExpanded(keys); for (const key of keys) if (!entries.has(String(key))) store.run(load(String(key))); }, [entries, load, store]);
  const reveal = async () => {
    const doc = store.active(); if (!doc || !workspace) return;
    const parents = doc.state.path.slice(workspace.path.length + 1).split('/').slice(0, -1);
    let path = workspace.path; const keys = new Set(expanded);
    for (const parent of parents) { path += '/' + parent; await load(path); keys.add(path); }
    setExpanded(keys); setSelected(new Set([doc.state.path])); store.api.getPanel('explorer')?.api.setActive();
  };
  const commandContext: CommandContext = { ready: restored && status.state === 'ready' && !store.suspended, busy: busyBuild,
    building: build.state === 'running', workspace: !!workspace, editor: !!store.active(), readOnly: !!store.active()?.readOnly, documents: !!store.documents.size };
  const command = (id: Command) => {
    if (id === 'quit') { execute(id); return; }
    store.run(window.rune.request<CommandInfo[]>('commands/list', { context: commandContext }).then(rows => {
      if (rows.find(row => row.id === id)?.enabled) execute(id);
    }));
  };
  const execute = (command: Command) => {
    if (command.startsWith('zoom-')) store.run(window.rune.zoom(command === 'zoom-reset' ? 0 : command === 'zoom-in' ? 1 : -1));
    if (command === 'palette') setPalette(true);
    if (command.startsWith('theme-')) setTheme(command.slice(6) as Theme);
    if (command === 'close-all') store.run((async () => { for (const panel of [...store.api.panels].filter(p => p.params?.path)) if (!await store.close(panel)) break; })());
    if (command === 'focus-editor') { const panel = store.activePanel(); panel?.api.setActive(); if (panel) store.editors.get(panel.id)?.focus(); }
    if (command === 'focus-explorer' || command === 'focus-output' || command === 'focus-problems') {
      const id = command.slice(6); store.api.getPanel(id)?.api.setActive();
      requestAnimationFrame(() => (document.querySelector(id === 'explorer' ? '.react-aria-Tree' : '.' + id) as HTMLElement | null)?.focus());
    }
    if (command === 'build') store.run(startBuild());
    if (command === 'cancel-build') store.run(window.rune.buildCancel());
    if (command === 'open-folder') openFolder();
    if (command === 'save') { setError(''); store.run(store.save()); }
    if (command === 'save-all') { setError(''); store.run(store.saveAll()); }
    if (command === 'split') store.run(store.split());
    if (command === 'close') store.run(store.close());
    if (command === 'reveal') store.run(reveal());
    if (command === 'quit' && !closing.current) store.run((async () => {
      closing.current = true;
      store.suspend(true);
      try {
        if (await store.prepareAll()) {
          clearTimeout(sessionTimer.current); await persistSession.current();
          await window.rune.finishClose();
        }
      } finally { closing.current = false; store.suspend(status.state !== 'ready'); }
    })());
  };
  const startBuild = async () => {
    if (busyBuild || !workspace) return;
    setSavingBuild(true); setError('');
    try {
      const start = performance.now(); await store.saveAll(); setSaveMs(performance.now() - start);
      const rows = await window.rune.request<BuildTarget[]>('build/targets', { activePath });
      setTargets(rows);
      const selected = rows.find(t => t.name === target) || rows[0];
      if (!selected) throw new Error('Open a source file, or add sources.txt or .rune-ide.json to define an ordered target');
      setTarget(selected.name); store.beginBuild();
      await window.rune.buildStart({ target: selected.name, activePath });
    } finally { setSavingBuild(false); }
  };
  useEffect(() => window.rune.onCommand(command));
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || document.querySelector('[role="dialog"]')) return;
      const primary = /Mac/.test(navigator.platform) ? event.metaKey : event.ctrlKey;
      const row = commandRows.find(row => {
        const keys = row.shortcut.toLowerCase().split('+');
        return !!row.shortcut && primary && !event.altKey && event.shiftKey === keys.includes('shift') && event.key.toLowerCase() === keys.at(-1);
      });
      if (row) { event.preventDefault(); event.stopPropagation(); command(row.id); }
    };
    window.addEventListener('keydown', keydown, true);
    return () => window.removeEventListener('keydown', keydown, true);
  });
  const onReady = (event: DockviewReadyEvent) => {
    store.api = event.api;
    const editor = event.api.addPanel({ id: 'welcome', component: 'welcome', tabComponent: 'fixed', title: 'Welcome' });
    event.api.addPanel({ id: 'explorer', component: 'explorer', tabComponent: 'fixed', title: 'Explorer', position: { referencePanel: editor.id, direction: 'left' }, initialWidth: 270 });
    event.api.addPanel({ id: 'output', component: 'output', tabComponent: 'fixed', title: 'Output', position: { referencePanel: editor.id, direction: 'below' }, initialHeight: 160 });
    event.api.addPanel({ id: 'problems', component: 'problems', tabComponent: 'fixed', title: 'Problems', position: { referencePanel: 'output', direction: 'within' }, inactive: true });
    event.api.onDidActivePanelChange(() => redraw(n => n + 1));
    event.api.onDidLayoutChange(() => store.sessionChanged());
    setLayoutReady(true);
  };
  const value: Context = { workspace, entries, expanded, selected, expand, select: setSelected, error, openFolder, store, build, showExcluded, fileAction, saveCopy, toggleExcluded: show => { setShowExcluded(show); refresh(show); }, refresh: () => refresh() };
  return <Workbench.Provider value={value}><div className="application">
    {palette && <CommandPalette context={commandContext} close={() => setPalette(false)} execute={command} />}
    <ModalOverlay isOpen={!!fileDialog} onOpenChange={open => { if (!open && !fileBusy) setFileDialog(null); }} isDismissable={!fileBusy}>
      <Modal><Dialog aria-label="File operation"><form onSubmit={event => { event.preventDefault(); void mutateFile(); }}>
        <Heading slot="title">{fileDialog?.kind === 'delete' ? 'Move to workspace trash?' : fileDialog?.kind === 'rename' ? 'Rename' : fileDialog?.kind === 'copy' ? 'Save a copy' : 'New ' + fileDialog?.kind}</Heading>
        <p className="dialog-path">{fileDialog?.path}</p>
        {fileDialog?.kind === 'delete' ? <p>Saved files are kept in .rune-ide/trash. Open editors for these files will close.</p> :
          <TextField autoFocus value={fileDialog?.name || ''} onChange={name => setFileDialog(previous => previous && ({ ...previous, name }))}><Label>Name</Label><Input /></TextField>}
        {fileError && <p className="error" role="alert">{fileError}</p>}
        <div className="dialog-buttons"><Button onPress={() => setFileDialog(null)} isDisabled={fileBusy}>Cancel</Button><Button type="submit" className="primary" isDisabled={fileBusy}>{fileDialog?.kind === 'delete' ? 'Move to trash' : 'Apply'}</Button></div>
      </form></Dialog></Modal>
    </ModalOverlay>
    <header><div className="brand"><span className="brand-mark">R</span> RUNE <span className="edition">STANDARD ML</span></div><span className="workspace-title">{workspace?.name || 'A place to think in types'}</span>
      <Button className="toolbar-button" onPress={() => command('palette')} isDisabled={status.state !== 'ready'}>Commands</Button>
      <Button className="toolbar-button" onPress={() => command('reveal')} isDisabled={!store.active()}>Reveal</Button>
      <Button className="toolbar-button" onPress={() => command('split')} isDisabled={!store.active()}>Split editor</Button>
      <Button className="toolbar-button" onPress={() => command('save')} isDisabled={!store.active()}>Save</Button>
      <Button className="toolbar-button" onPress={() => command('save-all')} isDisabled={!store.documents.size}>Save all</Button>
      <Button className="toolbar-button" onPress={() => command('open-folder')} isDisabled={!restored || status.state !== 'ready' || busyBuild}>Open folder</Button></header>
    <div className="build-bar">
      <label>Target <select aria-label="Build target" value={target} onChange={e => setTarget(e.target.value)} disabled={busyBuild}>
        {!targets.length && <option value="">Open a source file or project</option>}{targets.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
      </select></label>
      <Button className="toolbar-button" onPress={() => command('build')} isDisabled={!workspace || busyBuild || status.state !== 'ready'}>Save and Build</Button>
      <Button className="toolbar-button" onPress={() => command('cancel-build')} isDisabled={build.state !== 'running'}>Cancel build</Button>
      <span className={'build-state ' + build.state}>{savingBuild ? 'Saving…' : 'Build ' + build.state}</span>
      <span className="build-timings">{build.id !== null && 'Save ' + Math.round(saveMs) + ' ms · compile ' + Math.round(build.elapsedMs) + ' ms · report ' + Math.round(build.finishMs) + ' ms · markers ' + Math.round(markerMs) + ' ms'}</span>
      <Button className="toolchain-button" aria-label={"Toolchain: " + toolchain} onPress={() => store.run(window.rune.chooseToolchain().then(setToolchain))} isDisabled={busyBuild}>Toolchain</Button>
    </div>
    {(status.state === 'failed' || (restored && store.suspended && !closing.current)) && <div role="alert" className="error-banner">{status.state === 'failed' ? status.message : 'Editors are waiting to reconnect.'}
      <Button className="toolbar-button" onPress={() => store.run(restartService())} isDisabled={reconnecting || busyBuild}>Restart service</Button></div>}
    {recovery.length > 0 && <section className="recovery-banner" aria-label="Recover unsaved edits">
      <strong>Unsaved edits are available for recovery.</strong>
      {recovery.map(buffer => <div className="recovery-row" key={buffer.id}>
        <span title={buffer.path}>{buffer.path}</span>
        {discardRecovery === buffer.id ? <>
          <span>Discard these edits?</span><Button onPress={() => store.run(recoverBuffer(buffer, true))} isDisabled={recoveryBusy}>Discard permanently</Button>
          <Button onPress={() => setDiscardRecovery(null)}>Keep</Button>
        </> : <>
          <Button onPress={() => store.run(recoverBuffer(buffer))} isDisabled={recoveryBusy || !restored}>Restore</Button>
          <Button onPress={() => saveCopy(buffer.path, buffer.id)} isDisabled={recoveryBusy || !restored}>Save a copy</Button>
          <Button onPress={() => setDiscardRecovery(buffer.id)} isDisabled={recoveryBusy || !restored}>Discard</Button>
        </>}
      </div>)}
    </section>}
    <main><DockviewReact className="dockview-theme-rune" components={panels} tabComponents={tabs} onReady={onReady} /></main>
    <footer><span className={`service-state ${status.state}`}>● {status.state === 'ready' ? 'SML service connected' : status.message}</span><span>{workspace?.path || 'No workspace open'}</span><span className="footer-right">{Array.from(store.documents.values()).filter(d => store.dirty(d)).length} unsaved · Rune</span></footer>
  </div></Workbench.Provider>;
}
const panels: Record<string, React.FunctionComponent<IDockviewPanelProps>> = { explorer: Explorer, welcome: WelcomeEditor, editor: EditorPanel, output: Output, problems: Problems };
const tabs: Record<string, React.FunctionComponent<IDockviewPanelProps>> = { document: DocumentTab, fixed: FixedTab };
createRoot(document.getElementById('root')!).render(<App />);
