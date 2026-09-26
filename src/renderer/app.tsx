import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Checkbox, Tree, TreeItem, TreeItemContent, Collection, Key } from 'react-aria-components';
import { DockviewReact, DockviewReadyEvent, IDockviewPanelProps } from 'dockview-react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js';
import { Command, DirectoryEntry, ServiceStatus, Workspace } from '../shared/protocol';
import { EditorStore } from './editor-store';
import './sml-language';
import 'dockview-react/dist/styles/dockview.css';
import './style.css';

monaco.editor.defineTheme('rune', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#171a1f', 'editorLineNumber.foreground': '#535d6c', 'editorCursor.foreground': '#9bd3b3', 'editor.selectionBackground': '#34483f' } });
type Context = {
  workspace: Workspace | null; entries: Map<string, DirectoryEntry[]>; expanded: Set<Key>; selected: Set<Key>;
  expand: (keys: Set<Key>) => void; select: (keys: Set<Key>) => void; refresh: () => void;
  error: string; openFolder: () => void; store: EditorStore; showExcluded: boolean; toggleExcluded: (show: boolean) => void;
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
    const editor = monaco.editor.create(element.current!, { ...editorOptions, model: doc.model, ariaLabel: `Source editor ${props.params.path}` });
    const view = store.viewStates.get(props.api.id); if (view) editor.restoreViewState(view);
    const focus = editor.onDidFocusEditorWidget(() => props.api.setActive());
    const active = props.api.onDidActiveChange(({ isActive }) => { if (isActive) editor.focus(); });
    if (props.api.isActive) editor.focus();
    return () => { const view = editor.saveViewState(); if (view) store.viewStates.set(props.api.id, view); focus.dispose(); active.dispose(); editor.dispose(); };
  }, [props.params.path, props.api, store]);
  return <div ref={element} className="editor" data-document={props.params.path} />;
}
function DocumentTab(props: IDockviewPanelProps<{ path: string }>) {
  const { store } = useContext(Workbench);
  return <div className="document-tab" title={props.params.path}><span>{props.api.title}</span><Button aria-label={`Close ${props.api.title}`} onPointerDown={e => e.stopPropagation()} onPress={() => store.run(store.close(store.api.getPanel(props.api.id)))}>×</Button></div>;
}
function FixedTab(props: IDockviewPanelProps) { return <div className="fixed-tab">{props.api.title}</div>; }
function Output() { const { error } = useContext(Workbench); return <div className="output">{error ? <p className="error" role="alert">{error}</p> : <><p className="output-line"><span className="good">●</span> Workbench ready</p><p className="muted">Enter opens a selected file · Ctrl+S saves · Ctrl+Shift+S saves all · Ctrl+\ splits</p></>}</div>; }
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const [entries, setEntries] = useState(new Map<string, DirectoryEntry[]>());
  const [expanded, setExpanded] = useState(new Set<Key>());
  const [selected, setSelected] = useState(new Set<Key>());
  const [showExcluded, setShowExcluded] = useState(false);
  const [status, setStatus] = useState<ServiceStatus>({ state: 'starting', message: 'Starting service…' });
  const [error, setError] = useState('');
  const [, redraw] = useState(0);
  const [store] = useState(() => new EditorStore(() => redraw(n => n + 1), e => setError(e instanceof Error ? e.message : String(e))));
  const closing = useRef(false);
  useEffect(() => { void window.rune.status().then(setStatus); return window.rune.onStatus(setStatus); }, []);
  const load = async (path: string, excluded = showExcluded) => {
    const ws = workspaceRef.current;
    const rows = await window.rune.request<DirectoryEntry[]>('workspace/list', { path, showExcluded: excluded });
    if (workspaceRef.current === ws) setEntries(previous => new Map(previous).set(path, rows));
  };
  const openFolder = () => store.run((async () => {
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
  useEffect(() => window.rune.onCommand(command));
  const onReady = (event: DockviewReadyEvent) => {
    store.api = event.api;
    const editor = event.api.addPanel({ id: 'welcome', component: 'welcome', tabComponent: 'fixed', title: 'Welcome' });
    event.api.addPanel({ id: 'explorer', component: 'explorer', tabComponent: 'fixed', title: 'Explorer', position: { referencePanel: editor.id, direction: 'left' }, initialWidth: 270 });
    event.api.addPanel({ id: 'output', component: 'output', tabComponent: 'fixed', title: 'Output', position: { referencePanel: editor.id, direction: 'below' }, initialHeight: 160 });
    event.api.onDidActivePanelChange(() => redraw(n => n + 1));
  };
  const value: Context = { workspace, entries, expanded, selected, expand, select: setSelected, error, openFolder, store, showExcluded, toggleExcluded: show => { setShowExcluded(show); refresh(show); }, refresh: () => refresh() };
  return <Workbench.Provider value={value}><div className="application">
    <header><div className="brand"><span className="brand-mark">R</span> RUNE <span className="edition">STANDARD ML</span></div><span className="workspace-title">{workspace?.name || 'A place to think in types'}</span>
      <Button className="toolbar-button" onPress={() => command('reveal')} isDisabled={!store.active()}>Reveal</Button>
      <Button className="toolbar-button" onPress={() => command('split')} isDisabled={!store.active()}>Split editor</Button>
      <Button className="toolbar-button" onPress={() => command('save')} isDisabled={!store.active()}>Save</Button>
      <Button className="toolbar-button" onPress={() => command('save-all')} isDisabled={!store.documents.size}>Save all</Button>
      <Button className="toolbar-button" onPress={openFolder} isDisabled={status.state !== 'ready'}>Open folder</Button></header>
    {status.state === 'failed' && <div role="alert" className="error-banner">{status.message}</div>}
    <main><DockviewReact className="dockview-theme-rune" components={panels} tabComponents={tabs} onReady={onReady} /></main>
    <footer><span className={`service-state ${status.state}`}>● {status.state === 'ready' ? 'SML service connected' : status.message}</span><span>{workspace?.path || 'No workspace open'}</span><span className="footer-right">{Array.from(store.documents.values()).filter(d => store.dirty(d)).length} unsaved · Rune</span></footer>
  </div></Workbench.Provider>;
}
const panels: Record<string, React.FunctionComponent<IDockviewPanelProps>> = { explorer: Explorer, welcome: WelcomeEditor, editor: EditorPanel, output: Output };
const tabs: Record<string, React.FunctionComponent<IDockviewPanelProps>> = { document: DocumentTab, fixed: FixedTab };
createRoot(document.getElementById('root')!).render(<App />);
