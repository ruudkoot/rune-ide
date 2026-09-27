import { nativePath } from './native-path';
import { watch, FSWatcher } from 'node:fs';

// Native hints and a fallback pulse only. The SML service decides what changed.
export class WorkspaceWatcher {
  private paths: string[] = [];
  private handles = new Map<string, FSWatcher>();
  private pending?: ReturnType<typeof setTimeout>;
  private timer: ReturnType<typeof setInterval>;
  constructor(private notify: () => void, interval = 2000) {
    this.timer = setInterval(() => { this.attach(); this.pulse(); }, interval);
    this.timer.unref();
  }
  configure(paths: string[]) {
    this.paths = paths;
    for (const [path, handle] of this.handles) if (!paths.includes(path)) { handle.close(); this.handles.delete(path); }
    this.attach(); this.pulse();
  }
  private attach() {
    for (const path of this.paths) if (!this.handles.has(path)) {
      try {
        const handle = watch(nativePath(path), { persistent: false }, () => this.pulse());
        handle.on('error', () => { handle.close(); this.handles.delete(path); this.pulse(); });
        this.handles.set(path, handle);
      } catch { /* A missing folder or exhausted watch quota uses fallback rescans. */ }
    }
  }
  private pulse() {
    if (this.paths.length && !this.pending) this.pending = setTimeout(() => { this.pending = undefined; this.notify(); }, 100);
  }
  close() {
    clearInterval(this.timer); clearTimeout(this.pending);
    for (const handle of this.handles.values()) handle.close();
    this.handles.clear(); this.paths = [];
  }
}
