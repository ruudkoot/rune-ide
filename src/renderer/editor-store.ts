import * as monaco from 'monaco-editor/editor/editor.api.js';
import { DockviewApi, SerializedDockview } from 'dockview-react';
import { BuildStatus, Diagnostic, DiskState, DocumentSnapshot, DocumentState } from '../shared/protocol';

export type OpenDocument = {
  state: DocumentState; model: monaco.editor.ITextModel; savedValue: string;
  queue: Promise<void>; failed?: Error; subscription: monaco.IDisposable; readOnly: boolean;
  bom: boolean; acknowledgedVersion: number; diskState: DiskState; applying: boolean; refreshing?: boolean; closing?: boolean;
};
export type EditorLayout = { version: 1; layout: SerializedDockview; viewStates: Record<string, monaco.editor.ICodeEditorViewState>; expanded: string[]; selected: string[] };

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
  private identity = 0;
  private lastActive?: string;
  suspended = false;
  sessionChanged: () => void = () => {};
  suspend(value: boolean) {
    this.suspended = value;
    for (const editor of this.editors.values()) {
      const doc = [...this.documents.values()].find(d => d.model === editor.getModel());
      editor.updateOptions({ readOnly: value || !!doc?.readOnly });
    }
    this.changed();
  }
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
    // Stable model identity retains undo when the SML document path is renamed.
    const model = monaco.editor.createModel(snapshot.text, /\.(sml|sig|fun)$/.test(path) ? 'sml' : 'plaintext', monaco.Uri.from({ scheme: 'rune-document', path: '/' + (++this.identity) }));
    const doc: OpenDocument = { state: snapshot, model, savedValue: snapshot.savedText ?? snapshot.text, queue: Promise.resolve(), subscription: { dispose() {} }, readOnly: !!snapshot.readOnly, bom: snapshot.bom, acknowledgedVersion: model.getVersionId(), diskState: 'same', applying: false };
    doc.subscription = model.onDidChangeContent(event => {
      if (doc.applying) return;
      monaco.editor.setModelMarkers(model, 'rune', []); this.stalePaths.add(doc.state.path);
      const changes = event.changes.map(c => ({ offset: c.rangeOffset, length: c.rangeLength, text: c.text }));
      const version = model.getVersionId();
      doc.queue = doc.queue.then(async () => {
        doc.state = await window.rune.request<DocumentState>('document/change', { path: doc.state.path, revision: doc.state.revision, changes });
        doc.acknowledgedVersion = version; this.changed();
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
    if (existing && !split) { existing.api.setActive(); this.update(doc); return existing; }
    const reference = this.activePanel() || this.api.getPanel('welcome') || this.api.panels.find(p => p.params?.path);
    const panel = this.api.addPanel({ id: `document:${++this.serial}`, component: 'editor', tabComponent: 'document', title: path,
      params: { path: doc.state.path }, renderer: 'onlyWhenVisible',
      ...(reference ? { position: { referencePanel: reference.id, direction: split ? 'right' as const : 'within' as const } } : {}),
    });
    const welcome = this.api.getPanel('welcome'); if (welcome) this.api.removePanel(welcome);
    this.update(doc); return panel;
  }
  save(doc = this.active()): Promise<void> {
    if (!doc || doc.readOnly) return Promise.resolve();
    doc.queue = doc.queue.then(async () => {
      const saved = await window.rune.request<DocumentSnapshot>('document/save', { path: doc.state.path, revision: doc.state.revision });
      doc.state = saved; doc.savedValue = saved.savedText ?? saved.text; doc.bom = saved.bom; doc.diskState = 'same'; this.update(doc);
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
    const doc = this.documents.get(panel.params!.path);
    if (!doc) { this.api.removePanel(panel); this.viewStates.delete(panel.id); this.changed(); return true; }
    if (this.panels(doc.state.path).length === 1) {
      doc.closing = true; this.lockDocument(doc, true);
      try {
        if (!await this.prepare(doc)) return false;
        if (!doc.readOnly) await window.rune.request('document/close', { path: doc.state.path, revision: doc.state.revision, discard: true });
        this.api.removePanel(panel); this.viewStates.delete(panel.id);
        doc.subscription.dispose(); doc.model.dispose(); this.documents.delete(doc.state.path); this.stalePaths.delete(doc.state.path); this.buildVersions.delete(doc.state.path); this.revealRanges.delete(doc.state.path);
      } finally { doc.closing = false; if (!doc.model.isDisposed()) this.lockDocument(doc, false); }
    } else { this.api.removePanel(panel); this.viewStates.delete(panel.id); }
    this.changed(); return true;
  }
  private async prepare(doc: OpenDocument) {
    await doc.queue.catch(() => undefined);
    if (!doc.readOnly) {
      try { doc.diskState = (await window.rune.request<{ state: DiskState }>('document/check', { path: doc.state.path, revision: doc.state.revision })).state; }
      catch { /* Failed service still permits an explicit discard and exit. */ }
    }
    if (this.dirty(doc) || doc.diskState === 'missing') {
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
    for (const panel of this.api.panels.filter(p => p.params?.path)) this.api.removePanel(panel);
  }
  async split() { const doc = this.active(); if (doc) await this.open(doc.state.path, true); }
  private lockDocument(doc: OpenDocument, locked: boolean) {
    for (const editor of this.editors.values()) if (editor.getModel() === doc.model) editor.updateOptions({ readOnly: locked || this.suspended || doc.readOnly });
  }
  private async reloadNow(doc: OpenDocument, discard: boolean) {
    this.lockDocument(doc, true);
    try {
      const snapshot = await window.rune.request<DocumentSnapshot>('document/reload', { path: doc.state.path, revision: doc.state.revision, discard });
      const views = [...this.editors.values()].filter(e => e.getModel() === doc.model).map(e => [e, e.saveViewState()] as const);
      doc.applying = true;
      try { doc.model.setValue(snapshot.text); } finally { doc.applying = false; }
      doc.state = snapshot; doc.bom = snapshot.bom; doc.savedValue = snapshot.savedText ?? snapshot.text;
      doc.diskState = 'same'; doc.acknowledgedVersion = doc.model.getVersionId();
      for (const [editor, view] of views) if (view) editor.restoreViewState(view);
      monaco.editor.setModelMarkers(doc.model, 'rune', []); this.stalePaths.add(snapshot.path); this.update(doc);
    } finally { this.lockDocument(doc, false); }
  }
  async reload(doc: OpenDocument) {
    if (this.dirty(doc)) {
      const choice = await window.rune.confirmUnsaved(doc.state.path);
      if (choice === 'cancel') return;
      if (choice === 'save') await this.save(doc);
    }
    const task = doc.queue.then(() => this.reloadNow(doc, true));
    doc.queue = task.catch(() => undefined); await task;
  }
  async inspectDocuments() {
    if (this.suspended) return;
    await Promise.all([...this.documents.values()].filter(d => !d.readOnly && !d.failed && !d.refreshing && !d.closing).map(doc => {
      doc.refreshing = true;
      const task = doc.queue.then(async () => {
        if (this.suspended || doc.closing || doc.model.isDisposed()) return;
        const version = doc.model.getVersionId();
        const result = await window.rune.request<{ state: DiskState }>('document/check', { path: doc.state.path, revision: doc.state.revision });
        const previousDiskState = doc.diskState;
        doc.diskState = result.state;
        if (result.state !== 'same') { monaco.editor.setModelMarkers(doc.model, 'rune', []); this.stalePaths.add(doc.state.path); }
        if (result.state === 'changed' && !this.dirty(doc) && doc.model.getVersionId() === version && !this.suspended) await this.reloadNow(doc, false);
        if (previousDiskState !== doc.diskState) this.changed();
      });
      // Inspection failures must not poison the ordered edit queue.
      doc.queue = task.catch(error => { doc.diskState = 'unreadable'; this.report(error); }).finally(() => { doc.refreshing = false; });
      return doc.queue;
    }));
  }
  async settle() { for (const doc of this.documents.values()) await doc.queue; }
  rename(oldPath: string, path: string) {
    for (const [key, doc] of [...this.documents]) if (key === oldPath || key.startsWith(oldPath + '/')) {
      const next = path + key.slice(oldPath.length);
      this.documents.delete(key); doc.state = { ...doc.state, path: next }; this.documents.set(next, doc);
      for (const panel of this.panels(key)) panel.api.updateParameters({ path: next });
      monaco.editor.setModelLanguage(doc.model, /\.(sml|sig|fun)$/.test(next) ? 'sml' : 'plaintext');
      monaco.editor.setModelMarkers(doc.model, 'rune', []); this.stalePaths.add(next); this.update(doc);
    }
    this.sessionChanged();
  }
  removed(path: string) {
    for (const [key, doc] of [...this.documents]) if (key === path || key.startsWith(path + '/')) {
      for (const panel of this.panels(key)) { this.api.removePanel(panel); this.viewStates.delete(panel.id); }
      doc.subscription.dispose(); doc.model.dispose(); this.documents.delete(key);
    }
    this.changed(); this.sessionChanged();
  }
  capture(expanded: string[], selected: string[]): EditorLayout {
    for (const [id, editor] of this.editors) { const view = editor.saveViewState(); if (view) this.viewStates.set(id, view); }
    for (const id of this.viewStates.keys()) if (!this.api.getPanel(id)) this.viewStates.delete(id);
    return { version: 1, layout: this.api.toJSON(), viewStates: Object.fromEntries(this.viewStates), expanded, selected };
  }
  async restore(raw: unknown, pendingPaths: string[] = []) {
    const view = raw as EditorLayout;
    if (!view || view.version !== 1 || !view.layout?.panels || !view.layout.grid) return;
    const layout = structuredClone(view.layout);
    const allowed = new Set(['editor', 'welcome', 'explorer', 'output', 'problems']);
    for (const [id, panel] of Object.entries(layout.panels)) {
      if (!panel.contentComponent || !allowed.has(panel.contentComponent)) throw new Error('Saved layout contains an unknown panel');
      if (panel.contentComponent === 'editor') {
        try {
          const path = panel.params?.path;
          if (typeof path !== 'string' || !path.startsWith(this.root + '/')) throw new Error('External editors are not restored automatically');
          if (!pendingPaths.includes(path)) await this.load(path);
          this.serial = Math.max(this.serial, Number(id.split(':')[1]) || 0);
        } catch (error) { delete layout.panels[id]; this.report(error); }
      }
    }
    // Drop missing editors while retaining placeholders for pending recovery.
    const prune = (node: SerializedDockview['grid']['root']): boolean => {
      if (Array.isArray(node.data)) { node.data = node.data.filter(prune); return node.data.length > 0; }
      node.data.views = node.data.views.filter(id => layout.panels[id]);
      if (!node.data.views.includes(node.data.activeView || '')) node.data.activeView = node.data.views[0];
      return node.data.views.length > 0;
    };
    prune(layout.grid.root);
    // Floating and edge groups share the main document. Recover old popouts as
    // floating groups because native auxiliary windows are intentionally disabled.
    const pruneGroup = (group: { views: string[]; activeView?: string }) => {
      group.views = group.views.filter(id => layout.panels[id]);
      if (!group.views.includes(group.activeView || '')) group.activeView = group.views[0];
      return group.views.length > 0;
    };
    layout.floatingGroups = [...(layout.floatingGroups || []), ...(layout.popoutGroups || []).map(group => ({
      data: group.data, grid: group.grid, position: { left: 40, top: 40, width: 600, height: 400 },
    }))].filter(group => group.grid ? prune(group.grid.root) : group.data ? pruneGroup(group.data) : false);
    delete layout.popoutGroups;
    if (layout.edgeGroups) for (const key of ['top', 'bottom', 'left', 'right'] as const) {
      const group = layout.edgeGroups[key]?.group as { views: string[]; activeView?: string } | undefined;
      if (group && (!Array.isArray(group.views) || !pruneGroup(group))) delete layout.edgeGroups[key];
    }
    for (const [id, state] of Object.entries(view.viewStates || {})) if (layout.panels[id]) this.viewStates.set(id, state);
    this.api.fromJSON(layout);
    for (const doc of this.documents.values()) this.update(doc);
  }
  async reconnect() {
    if (!this.root) return;
    await window.rune.request('workspace/open', { path: this.root });
    for (const doc of this.documents.values()) {
      if (doc.readOnly) continue;
      await doc.queue.catch(() => undefined);
      const value = doc.model.getValue();
      doc.state = await window.rune.request<DocumentSnapshot>('document/attach', {
        path: doc.state.path, text: value, savedText: doc.savedValue, bom: doc.bom,
      });
      doc.savedValue = (doc.state as DocumentSnapshot).savedText ?? doc.savedValue;
      doc.queue = Promise.resolve(); doc.failed = undefined; doc.acknowledgedVersion = doc.model.getVersionId(); this.update(doc);
    }
  }
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
