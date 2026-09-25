import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Tree, TreeItem, TreeItemContent, Collection, Key } from 'react-aria-components';
import { DockviewReact, DockviewReadyEvent, IDockviewPanelProps } from 'dockview-react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import { DirectoryEntry, ServiceStatus, Workspace } from '../shared/protocol';
import 'dockview-react/dist/styles/dockview.css';
import './style.css';

monaco.editor.defineTheme('rune', { base: 'vs-dark', inherit: true, rules: [], colors: { 'editor.background': '#171a1f', 'editorLineNumber.foreground': '#535d6c', 'editorCursor.foreground': '#9bd3b3', 'editor.selectionBackground': '#34483f' } });
type Context = { workspace: Workspace | null; entries: Map<string, DirectoryEntry[]>; expanded: Set<Key>; expand: (keys: Set<Key>) => void; refresh: () => void; error: string; openFolder: () => void };
const Workbench = createContext<Context>(null!);

function Explorer() {
  const state = useContext(Workbench);
  const render = (entry: DirectoryEntry): React.ReactElement => <TreeItem key={entry.path} id={entry.path} textValue={entry.name} hasChildItems={entry.directory && !entry.symlink}>
    <TreeItemContent>{({ isExpanded }) => <><Button slot="chevron" className="chevron" aria-label={`Expand ${entry.name}`}>{entry.directory && !entry.symlink ? (isExpanded ? '⌄' : '›') : ''}</Button><span className={entry.directory ? 'folder-icon' : 'file-icon'}>{entry.directory ? '▱' : 'λ'}</span><span>{entry.name}</span>{entry.symlink && <span className="muted"> ↗</span>}</>}</TreeItemContent>
    <Collection dependencies={[state.entries]} items={state.entries.get(entry.path) || []}>{render}</Collection>
    {entry.directory && !entry.symlink && !state.entries.has(entry.path) && <TreeItem id={`${entry.path}/:loading`} textValue="Loading" isDisabled><TreeItemContent>Loading…</TreeItemContent></TreeItem>}
  </TreeItem>;
  return <section className="explorer">
    <div className="panel-tools"><span>{state.workspace?.name || 'WORKSPACE'}</span><Button aria-label="Refresh file tree" onPress={state.refresh} isDisabled={!state.workspace}>↻</Button></div>
    {state.workspace ? <Tree dependencies={[state.entries]} aria-label="Source files" selectionMode="single" expandedKeys={state.expanded} onExpandedChange={state.expand} items={state.entries.get(state.workspace.path) || []}>{render}</Tree>
      : <div className="empty"><p>Bring your sources<br/>into focus.</p><Button className="primary" onPress={state.openFolder}>Open folder</Button><small>Files are read by the SML service.</small></div>}
  </section>;
}
function WelcomeEditor() {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const editor = monaco.editor.create(element.current!, { value: '(* Welcome to Rune. *)\n\n(* Open a folder to explore your Standard ML sources.\n   The workbench is connected to a service written in SML. *)\n\nstructure Hello =\nstruct\n  val greeting = "Hello, Rune"\nend\n', language: 'plaintext', readOnly: true, theme: 'rune', fontSize: 14, fontFamily: '"DejaVu Sans Mono", monospace', minimap: { enabled: false }, automaticLayout: true, padding: { top: 24 }, scrollBeyondLastLine: false });
    return () => { editor.getModel()?.dispose(); editor.dispose(); };
  }, []);
  return <div ref={element} className="editor" aria-label="Welcome editor" />;
}
function Output() { const { error } = useContext(Workbench); return <div className="output">{error ? <p className="error">{error}</p> : <><p className="output-line"><span className="good">●</span> Workbench ready</p><p className="muted">Workspace operations run in Standard ML. Choose a folder to begin.</p></>}</div>; }
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [entries, setEntries] = useState(new Map<string, DirectoryEntry[]>());
  const [expanded, setExpanded] = useState(new Set<Key>());
  const [status, setStatus] = useState<ServiceStatus>({ state: 'starting', message: 'Starting service…' });
  const [error, setError] = useState('');
  useEffect(() => { void window.rune.status().then(setStatus); return window.rune.onStatus(setStatus); }, []);
  const load = async (path: string) => { const rows = await window.rune.request<DirectoryEntry[]>('workspace/list', { path }); setEntries((previous) => new Map(previous).set(path, rows)); };
  const handle = (task: Promise<unknown>) => { void task.catch((e) => setError(String(e.message || e))); };
  const openFolder = () => handle((async () => {
    const path = await window.rune.chooseFolder(); if (!path) return;
    const ws = await window.rune.request<Workspace>('workspace/open', { path });
    setWorkspace(ws); setEntries(new Map()); setExpanded(new Set()); setError(''); await load(ws.path);
  })());
  const expand = (keys: Set<Key>) => { setExpanded(keys); for (const key of keys) if (!entries.has(String(key))) handle(load(String(key))); };
  const onReady = (event: DockviewReadyEvent) => {
    const editor = event.api.addPanel({ id: 'welcome', component: 'welcome', title: 'Welcome.sml' });
    event.api.addPanel({ id: 'explorer', component: 'explorer', title: 'Explorer', position: { referencePanel: editor.id, direction: 'left' }, initialWidth: 270 });
    event.api.addPanel({ id: 'output', component: 'output', title: 'Output', position: { referencePanel: editor.id, direction: 'below' }, initialHeight: 180 });
  };
  const value = { workspace, entries, expanded, expand, error, openFolder, refresh: () => { if (workspace) handle(load(workspace.path)); } };
  return <Workbench.Provider value={value}><div className="application">
    <header><div className="brand"><span className="brand-mark">R</span> RUNE <span className="edition">STANDARD ML</span></div><span className="workspace-title">{workspace?.name || 'A place to think in types'}</span><Button className="toolbar-button" onPress={openFolder} isDisabled={status.state !== 'ready'}>Open folder</Button></header>
    {status.state === 'failed' && <div role="alert" className="error-banner">{status.message}</div>}
    <main><DockviewReact className="dockview-theme-rune" components={panels} onReady={onReady} /></main>
    <footer><span className={`service-state ${status.state}`}>● {status.state === 'ready' ? 'SML service connected' : status.message}</span><span>{workspace?.path || 'No workspace open'}</span><span className="footer-right">Rune · Electron / Dockview / Monaco</span></footer>
  </div></Workbench.Provider>;
}
const panels: Record<string, React.FunctionComponent<IDockviewPanelProps>> = { explorer: Explorer, welcome: WelcomeEditor, output: Output };
createRoot(document.getElementById('root')!).render(<App />);
