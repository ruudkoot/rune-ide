import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Checkbox, Tree, TreeItem, TreeItemContent, Collection, Key } from 'react-aria-components';
import { DockviewReact, DockviewReadyEvent, IDockviewPanelProps } from 'dockview-react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/gotoError/browser/gotoError.js';
import { BuildStatus, BuildTarget, Command, DirectoryEntry, ServiceStatus, Workspace } from '../shared/protocol';
import { EditorStore } from './editor-store';
import './sml-language';
import 'dockview-react/dist/styles/dockview.css';
import './style.css';

monaco.editor.defineTheme('rune', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#171a1f', 'editorLineNumber.foreground': '#535d6c', 'editorCursor.foreground': '#9bd3b3', 'editor.selectionBackground': '#34483f' } });
type Context = {
  workspace: Workspace | null; entries: Map<string, DirectoryEntry[]>; expanded: Set<Key>; selected: Set<Key>;
  expand: (keys: Set<Key>) => void; select: (keys: Set<Key>) => void; refresh: () => void;
  error: string; openFolder: () => void; store: EditorStore; showExcluded: boolean; toggleExcluded: (show: boolean) => void;
  build: BuildStatus;
};
const Workbench = createContext<Context>(null!);

function Explorer() {
  const state = useContext(Workbench);
  const render = (entry: DirectoryEntry): React.ReactElement => <TreeItem key={entry.path} id={entry.path} textValue={entry.name} hasChildItems={entry.directory && !entry.symlink}
    onAction={() => { if (!entry.directory) state.store.run(state.store.open(entry.path)); }}>
    <TreeItemContent>{({ isExpanded }) => <>{entry.directory && !entry.symlink ? <Button slot="chevron" className="chevron">{isExpanded ? '⌄' : '›'}</Button> : <span className="chevron"/>}<span className={entry.directory ? 'folder-icon' : 'file-icon'}>{entry.directory ? '▱' : 'λ'}</span><span>{entry.name}</span>{entry.symlink && <span className="muted"> ↗</span>}</>}</TreeItemContent>
    <Collection dependencies={[state.entries]} items={state.entries.get(entry.path) || []}>{render}</Collection>
    {entry.directory && !entry.symlink && !state.entries.get(entry.path)?.length && <TreeItem id={`${entry.path}/:placeholder`} textValue="Directory status" isDisabled><TreeItemContent><span className="muted">{state.entries.has(entry.path) ? 'Empty folder' : 'Loading…'}</span></TreeItemContent></TreeItem>}
  </TreeItem>;
  return <section className="explorer">
    <div className="panel-tools"><span>{state.workspace?.name || 'WORKSPACE'}</span><Button aria-label="Refresh file tree" onPress={state.refresh} isDisabled={!state.workspace}>↻</Button></div>
    {state.workspace ? <><Checkbox className="excluded-toggle" isSelected={state.showExcluded} onChange={state.toggleExcluded}><span className="check-box"/>Show excluded files</Checkbox>
      <Tree dependencies={[state.entries]} aria-label="Source files" selectionMode="single" selectionBehavior="replace" selectedKeys={state.selected} onSelectionChange={keys => state.select(keys as Set<Key>)} expandedKeys={state.expanded} onExpandedChange={state.expand} items={state.entries.get(state.workspace.path) || []}>{render}</Tree></>
      : <div className="empty"><p>Bring your sources<br/>into focus.</p><Button className="primary" onPress={state.openFolder}>Open folder</Button><small>Open a file with Enter or a double click.</small></div>}
  </section>;
}
const editorOptions: monaco.editor.IStandaloneEditorConstructionOptions = { theme: 'rune', fontSize: 14, fontFamily: '"DejaVu Sans Mono", monospace', minimap: { enabled: false }, automaticLayout: true, padding: { top: 18 }, scrollBeyondLastLine: false };
function WelcomeEditor() {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = monaco.editor.create(element.current!, { ...editorOptions, value: '(* Welcome to Rune. *)\n\n(* Open a folder, then double-click a source file\n   or select it and press Enter. *)\n\nstructure Hello =\nstruct\n  val greeting = "Hello, Rune"\nend\n', language: 'sml', readOnly: true });
    return () => { editor.getModel()?.dispose(); editor.dispose(); };
  }, []);
  return <div ref={element} className="editor" aria-label="Welcome editor" />;
}
function EditorPanel(props: IDockviewPanelProps<{ path: string }>) {
  const { store } = useContext(Workbench);
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const doc = store.documents.get(props.params.path)!;
    const editor = monaco.editor.create(element.current!, { ...editorOptions, model: doc.model, readOnly: doc.readOnly, ariaLabel: `Source editor ${props.params.path}` });
    const view = store.viewStates.get(props.api.id); if (view) editor.restoreViewState(view);
    store.editors.set(props.api.id, editor);
    const range = store.revealRanges.get(props.params.path);
    if (range) { editor.setSelection(range); editor.revealRangeInCenter(range); store.revealRanges.delete(props.params.path); }
    const focus = editor.onDidFocusEditorWidget(() => props.api.setActive());
    const active = props.api.onDidActiveChange(({ isActive }) => { if (isActive) editor.focus(); });
    if (props.api.isActive) editor.focus();
    return () => { const view = editor.saveViewState(); if (view) store.viewStates.set(props.api.id, view); store.editors.delete(props.api.id); focus.dispose(); active.dispose(); editor.dispose(); };
  }, [props.params.path, props.api, store]);
  return <div ref={element} className="editor" data-document={props.params.path} />;
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
  return <div ref={element} className="output">{error && <p className="error" role="alert">{error}</p>}
    {build.log ? <pre>{build.log}</pre> : <><p className="output-line"><span className="good">●</span> Workbench ready</p><p className="muted">Enter opens a file · Ctrl+S saves · Ctrl+Shift+B builds</p></>}
  </div>;
}
function Problems() {
  const { build, store } = useContext(Workbench);
  return <div className="problems">
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
  const [, redraw] = useState(0);
  const [store] = useState(() => new EditorStore(() => redraw(n => n + 1), e => { setError((e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': Error: /, '')); store?.api?.getPanel('output')?.api.setActive(); }));
  const closing = useRef(false);
  const activePath = store.active()?.state.path;
  const busyBuild = savingBuild || build.state === 'running';
  useEffect(() => {
    void window.rune.toolchain().then(setToolchain);
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
  const load = async (path: string, excluded = showExcluded) => {
    const ws = workspaceRef.current;
    const rows = await window.rune.request<DirectoryEntry[]>('workspace/list', { path, showExcluded: excluded });
    if (workspaceRef.current === ws) setEntries(previous => new Map(previous).set(path, rows));
  };
  const openFolder = () => store.run((async () => {
    if (busyBuild) throw new Error('Finish or cancel the active build before changing workspace');
    const path = await window.rune.chooseFolder(); if (!path || closing.current) return;
    closing.current = true;
    try {
      if (!await store.prepareAll()) return;
      await store.clear();
      const ws = await window.rune.request<Workspace>('workspace/open', { path });
      workspaceRef.current = ws; store.root = ws.path;
      setWorkspace(ws); setEntries(new Map()); setExpanded(new Set()); setSelected(new Set()); setError(''); await load(ws.path);
    } finally { closing.current = false; }
  })());
  const refresh = (excluded = showExcluded) => {
    setError('');
    if (workspace) for (const path of [workspace.path, ...Array.from(expanded, String)]) store.run(load(path, excluded));
  };
  const expand = (keys: Set<Key>) => { setExpanded(keys); for (const key of keys) if (!entries.has(String(key))) store.run(load(String(key))); };
  const reveal = async () => {
    const doc = store.active(); if (!doc || !workspace) return;
    const parents = doc.state.path.slice(workspace.path.length + 1).split('/').slice(0, -1);
    let path = workspace.path; const keys = new Set(expanded);
    for (const parent of parents) { path += '/' + parent; await load(path); keys.add(path); }
    setExpanded(keys); setSelected(new Set([doc.state.path])); store.api.getPanel('explorer')?.api.setActive();
  };
  const command = (command: Command) => {
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
      try { if (await store.prepareAll()) await window.rune.finishClose(); } finally { closing.current = false; }
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
  const onReady = (event: DockviewReadyEvent) => {
    store.api = event.api;
    const editor = event.api.addPanel({ id: 'welcome', component: 'welcome', tabComponent: 'fixed', title: 'Welcome' });
    event.api.addPanel({ id: 'explorer', component: 'explorer', tabComponent: 'fixed', title: 'Explorer', position: { referencePanel: editor.id, direction: 'left' }, initialWidth: 270 });
    event.api.addPanel({ id: 'output', component: 'output', tabComponent: 'fixed', title: 'Output', position: { referencePanel: editor.id, direction: 'below' }, initialHeight: 160 });
    event.api.addPanel({ id: 'problems', component: 'problems', tabComponent: 'fixed', title: 'Problems', position: { referencePanel: 'output', direction: 'within' }, inactive: true });
    event.api.onDidActivePanelChange(() => redraw(n => n + 1));
  };
  const value: Context = { workspace, entries, expanded, selected, expand, select: setSelected, error, openFolder, store, build, showExcluded, toggleExcluded: show => { setShowExcluded(show); refresh(show); }, refresh: () => refresh() };
  return <Workbench.Provider value={value}><div className="application">
    <header><div className="brand"><span className="brand-mark">R</span> RUNE <span className="edition">STANDARD ML</span></div><span className="workspace-title">{workspace?.name || 'A place to think in types'}</span>
      <Button className="toolbar-button" onPress={() => command('reveal')} isDisabled={!store.active()}>Reveal</Button>
      <Button className="toolbar-button" onPress={() => command('split')} isDisabled={!store.active()}>Split editor</Button>
      <Button className="toolbar-button" onPress={() => command('save')} isDisabled={!store.active()}>Save</Button>
      <Button className="toolbar-button" onPress={() => command('save-all')} isDisabled={!store.documents.size}>Save all</Button>
      <Button className="toolbar-button" onPress={openFolder} isDisabled={status.state !== 'ready' || busyBuild}>Open folder</Button></header>
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
    {status.state === 'failed' && <div role="alert" className="error-banner">{status.message}</div>}
    <main><DockviewReact className="dockview-theme-rune" components={panels} tabComponents={tabs} onReady={onReady} /></main>
    <footer><span className={`service-state ${status.state}`}>● {status.state === 'ready' ? 'SML service connected' : status.message}</span><span>{workspace?.path || 'No workspace open'}</span><span className="footer-right">{Array.from(store.documents.values()).filter(d => store.dirty(d)).length} unsaved · Rune</span></footer>
  </div></Workbench.Provider>;
}
const panels: Record<string, React.FunctionComponent<IDockviewPanelProps>> = { explorer: Explorer, welcome: WelcomeEditor, editor: EditorPanel, output: Output, problems: Problems };
const tabs: Record<string, React.FunctionComponent<IDockviewPanelProps>> = { document: DocumentTab, fixed: FixedTab };
createRoot(document.getElementById('root')!).render(<App />);
