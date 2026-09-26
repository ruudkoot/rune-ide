import * as monaco from 'monaco-editor/editor/editor.api.js';
import { DockviewApi, IDockviewPanel } from 'dockview-react';
import { DocumentSnapshot, DocumentState } from '../shared/protocol';

export type OpenDocument = {
  state: DocumentState; model: monaco.editor.ITextModel; savedValue: string;
  queue: Promise<void>; failed?: Error; subscription: monaco.IDisposable;
};

// Monaco owns presentation and undo; SML acknowledges every domain edit and save.
export class EditorStore {
  api!: DockviewApi;
  root = '';
  documents = new Map<string, OpenDocument>();
  viewStates = new Map<string, monaco.editor.ICodeEditorViewState>();
  private opening = new Map<string, Promise<OpenDocument>>();
  private serial = 0;
  constructor(readonly changed: () => void, readonly report: (error: unknown) => void) {}
  run(task: Promise<unknown>) { void task.catch(this.report); }
  activePanel() { const p = this.api?.activePanel; return p?.params?.path ? p : undefined; }
  active() { const p = this.activePanel(); return p ? this.documents.get(p.params!.path) : undefined; }
  dirty(doc: OpenDocument) { return doc.model.getValue() !== doc.savedValue; }
  panels(path: string) { return this.api.panels.filter(p => p.params?.path === path); }
  update(doc: OpenDocument) {
    const relative = doc.state.path.startsWith(this.root + '/') ? doc.state.path.slice(this.root.length + 1) : doc.state.path;
    for (const panel of this.panels(doc.state.path)) panel.api.setTitle(`${relative}${this.dirty(doc) ? ' ●' : ''}`);
    this.changed();
  }
  private async load(path: string): Promise<OpenDocument> {
    const snapshot = await window.rune.request<DocumentSnapshot>('document/open', { path });
    const existing = this.documents.get(snapshot.path); if (existing) return existing;
    const model = monaco.editor.createModel(snapshot.text, /\.(sml|sig|fun)$/.test(path) ? 'sml' : 'plaintext', monaco.Uri.file(snapshot.path));
    const doc: OpenDocument = { state: snapshot, model, savedValue: snapshot.text, queue: Promise.resolve(), subscription: { dispose() {} } };
    doc.subscription = model.onDidChangeContent(event => {
      const changes = event.changes.map(c => ({ offset: c.rangeOffset, length: c.rangeLength, text: c.text }));
      doc.queue = doc.queue.then(async () => {
        doc.state = await window.rune.request<DocumentState>('document/change', { path: snapshot.path, revision: doc.state.revision, changes });
      }).catch(error => { doc.failed = error; throw error; });
      this.run(doc.queue); this.update(doc);
    });
    this.documents.set(snapshot.path, doc); return doc;
  }
  async open(path: string, split = false) {
    let doc = this.documents.get(path);
    if (!doc) {
      let pending = this.opening.get(path);
      if (!pending) { pending = this.load(path); this.opening.set(path, pending); }
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
    if (!doc) return Promise.resolve();
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
  async saveAll() { for (const doc of this.documents.values()) if (this.dirty(doc)) await this.save(doc); }
  async close(panel = this.activePanel()) {
    if (!panel) return true;
    const doc = this.documents.get(panel.params!.path)!;
    if (this.panels(doc.state.path).length === 1) {
      if (!await this.prepare(doc)) return false;
      await window.rune.request('document/close', { path: doc.state.path, revision: doc.state.revision, discard: true });
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
      await window.rune.request('document/close', { path: doc.state.path, revision: doc.state.revision, discard: true });
      for (const panel of this.panels(doc.state.path)) this.api.removePanel(panel);
      doc.subscription.dispose(); doc.model.dispose();
    }
    this.documents.clear(); this.viewStates.clear(); this.changed();
  }
  async split() { const doc = this.active(); if (doc) await this.open(doc.state.path, true); }
}
