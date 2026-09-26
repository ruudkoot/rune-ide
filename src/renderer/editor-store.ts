import * as monaco from 'monaco-editor/editor/editor.api.js';
import { DockviewApi, IDockviewPanel } from 'dockview-react';
import { BuildStatus, Diagnostic, DocumentSnapshot, DocumentState } from '../shared/protocol';

export type OpenDocument = {
  state: DocumentState; model: monaco.editor.ITextModel; savedValue: string;
  queue: Promise<void>; failed?: Error; subscription: monaco.IDisposable; readOnly: boolean;
};

// Monaco owns presentation and undo; SML acknowledges every domain edit and save.
export class EditorStore {
  api!: DockviewApi;
  root = '';
  documents = new Map<string, OpenDocument>();
  viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();
  editors = new Map<string, monaco.editor.IStandaloneCodeEditor>();
  revealRanges = new Map<string, monaco.IRange>();
  stalePaths = new Set<string>();
  private diagnostics: Diagnostic[] = [];
  private buildVersions = new Map<string, number>();
  private opening = new Map<string, Promise<OpenDocument>>();
  private serial = 0;
  private lastActive?: string;
  constructor(readonly changed: () => void, readonly report: (error: unknown) => void) {}
  run(task: Promise<unknown>) { void task.catch(this.report); }
  activePanel() {
    const p = this.api?.activePanel;
    if (p?.params?.path) { this.lastActive = p.id; return p; }
    return this.lastActive ? this.api?.getPanel(this.lastActive) : undefined;
  }
  active() { const p = this.activePanel(); return p ? this.documents.get(p.params!.path) : undefined; }
  dirty(doc: OpenDocument) { return doc.model.getValue() !== doc.savedValue; }
  panels(path: string) { return this.api.panels.filter(p => p.params?.path === path); }
  update(doc: OpenDocument) {
    const relative = doc.state.path.startsWith(this.root + '/') ? doc.state.path.slice(this.root.length + 1) : doc.state.path;
    for (const panel of this.panels(doc.state.path)) panel.api.setTitle(`${relative}${this.dirty(doc) ? ' ●' : ''}`);
    this.changed();
  }
  private async load(path: string, supplied?: DocumentSnapshot): Promise<OpenDocument> {
    const snapshot = supplied || await window.rune.request<DocumentSnapshot>('document/open', { path });
    const existing = this.documents.get(snapshot.path); if (existing) return existing;
    const model = monaco.editor.createModel(snapshot.text, /\.(sml|sig|fun)$/.test(path) ? 'sml' : 'plaintext', monaco.Uri.file(snapshot.path));
    const doc: OpenDocument = { state: snapshot, model, savedValue: snapshot.text, queue: Promise.resolve(), subscription: { dispose() {} }, readOnly: !!snapshot.readOnly };
    doc.subscription = model.onDidChangeContent(event => {
      monaco.editor.setModelMarkers(model, 'rune', []); this.stalePaths.add(snapshot.path);
      const changes = event.changes.map(c => ({ offset: c.rangeOffset, length: c.rangeLength, text: c.text }));
      doc.queue = doc.queue.then(async () => {
        doc.state = await window.rune.request<DocumentState>('document/change', { path: snapshot.path, revision: doc.state.revision, changes });
      }).catch(error => { doc.failed = error; throw error; });
      this.run(doc.queue); this.update(doc);
    });
    this.documents.set(snapshot.path, doc); this.markers(doc); return doc;
  }
  async open(path: string, split = false, supplied?: DocumentSnapshot) {
    let doc = this.documents.get(path);
    if (!doc) {
      let pending = this.opening.get(path);
      if (!pending) { pending = this.load(path, supplied); this.opening.set(path, pending); }
      try { doc = await pending; } finally { this.opening.delete(path); }
    }
    const existing = this.panels(doc.state.path)[0];
    if (existing && !split) { existing.api.setActive(); return existing; }
    const reference = this.activePanel() || this.api.getPanel('welcome') || this.api.panels.find(p => p.params?.path);
    const panel = this.api.addPanel({ id: `document:${++this.serial}`, component: 'editor', tabComponent: 'document', title: path,
      params: { path: doc.state.path }, renderer: 'always',
      ...(reference ? { position: { referencePanel: reference.id, direction: split ? 'right' as const : 'within' as const } } : {}),
    });
    const welcome = this.api.getPanel('welcome'); if (welcome) this.api.removePanel(welcome);
    this.update(doc); return panel;
  }
  save(doc = this.active()): Promise<void> {
    if (!doc || doc.readOnly) return Promise.resolve();
    const value = doc.model.getValue();
    doc.queue = doc.queue.then(async () => {
      doc.state = await window.rune.request<DocumentState>('document/save', { path: doc.state.path, revision: doc.state.revision });
      doc.savedValue = value; this.update(doc);
    });
    // A conflict blocks this save but does not poison subsequent editing requests.
    const result = doc.queue;
    doc.queue = result.catch(() => { if (doc.failed) throw doc.failed; });
    void doc.queue.catch(() => undefined);
    return result;
  }
  async saveAll() {
    for (const doc of this.documents.values()) {
      await doc.queue;
      if (this.dirty(doc)) await this.save(doc);
    }
  }
  async close(panel = this.activePanel()) {
    if (!panel) return true;
    const doc = this.documents.get(panel.params!.path)!;
    if (this.panels(doc.state.path).length === 1) {
      if (!await this.prepare(doc)) return false;
      if (!doc.readOnly) await window.rune.request('document/close', { path: doc.state.path, revision: doc.state.revision, discard: true });
      this.api.removePanel(panel); this.viewStates.delete(panel.id);
      doc.subscription.dispose(); doc.model.dispose(); this.documents.delete(doc.state.path);
    } else { this.api.removePanel(panel); this.viewStates.delete(panel.id); }
    this.changed(); return true;
  }
  private async prepare(doc: OpenDocument) {
    if (this.dirty(doc)) {
      const choice = await window.rune.confirmUnsaved(doc.state.path);
      if (choice === 'cancel') return false;
      if (choice === 'save') await this.save(doc);
    }
    await doc.queue.catch(() => undefined); return true;
  }
  async prepareAll() { for (const doc of this.documents.values()) if (!await this.prepare(doc)) return false; return true; }
  async clear() {
    for (const doc of this.documents.values()) {
      if (!doc.readOnly) await window.rune.request('document/close', { path: doc.state.path, revision: doc.state.revision, discard: true });
      for (const panel of this.panels(doc.state.path)) this.api.removePanel(panel);
      doc.subscription.dispose(); doc.model.dispose();
    }
    this.documents.clear(); this.viewStates.clear(); this.changed();
  }
  async split() { const doc = this.active(); if (doc) await this.open(doc.state.path, true); }
  beginBuild() {
    this.diagnostics = []; this.stalePaths.clear(); this.buildVersions.clear();
    for (const doc of this.documents.values()) {
      this.buildVersions.set(doc.state.path, doc.model.getVersionId());
      monaco.editor.setModelMarkers(doc.model, 'rune', []);
    }
  }
  applyBuild(status: BuildStatus) {
    this.diagnostics = status.state === 'success' || status.state === 'failed' ? status.diagnostics : [];
    for (const doc of this.documents.values()) {
      const version = this.buildVersions.get(doc.state.path);
      if (version !== undefined && version !== doc.model.getVersionId()) this.stalePaths.add(doc.state.path);
      this.markers(doc);
    }
  }
  private markers(doc: OpenDocument) {
    const rows = this.stalePaths.has(doc.state.path) || this.dirty(doc) ? [] : this.diagnostics.filter(d => d.path === doc.state.path && d.range);
    monaco.editor.setModelMarkers(doc.model, 'rune', rows.map(d => ({ ...d.range!, message: d.message,
      severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning })));
  }
  async navigate(diagnostic: Diagnostic, index: number) {
    if (!diagnostic.path) return;
    const snapshot = await window.rune.request<DocumentSnapshot>('diagnostic/open', { index });
    if (diagnostic.range) this.revealRanges.set(snapshot.path, diagnostic.range);
    const panel = await this.open(snapshot.path, false, snapshot);
    const editor = this.editors.get(panel.id);
    if (editor && diagnostic.range) { editor.setSelection(diagnostic.range); editor.revealRangeInCenter(diagnostic.range); editor.focus(); }
  }
}
