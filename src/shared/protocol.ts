export type DirectoryEntry = { path: string; name: string; directory: boolean; symlink: boolean };
export type Workspace = { path: string; name: string };
export type ServiceStatus = { state: 'starting' | 'ready' | 'failed'; message: string };
export type DocumentState = { path: string; revision: number; dirty: boolean };
export type DocumentSnapshot = DocumentState & { text: string; bom: boolean; readOnly?: boolean };
export type Command = 'save' | 'save-all' | 'split' | 'close' | 'open-folder' | 'reveal' | 'quit' | 'build' | 'cancel-build';
export type Diagnostic = { severity: 'error' | 'warning'; message: string; path: string; range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null };
export type BuildTarget = { name: string; sources: string[]; output: string };
export type BuildResult = { id: number; state: 'success' | 'failed' | 'cancelled' | 'stale'; diagnostics: Diagnostic[]; output: string | null; sources: string[] };
export type BuildStatus = Omit<BuildResult, 'id' | 'state'> & { id: number | null; state: 'idle' | 'running' | BuildResult['state']; log: string; elapsedMs: number; finishMs: number };
export interface RuneBridge {
  request<T>(method: string, params?: unknown): Promise<T>;
  chooseFolder(): Promise<string | null>;
  status(): Promise<ServiceStatus>;
  onStatus(listener: (status: ServiceStatus) => void): () => void;
  confirmUnsaved(path: string): Promise<'save' | 'discard' | 'cancel'>;
  onCommand(listener: (command: Command) => void): () => void;
  finishClose(): Promise<void>;
  buildStart(params: { target: string; activePath?: string }): Promise<void>;
  buildCancel(): Promise<void>;
  buildStatus(): Promise<BuildStatus>;
  onBuild(listener: (status: BuildStatus) => void): () => void;
  toolchain(): Promise<string>;
  chooseToolchain(): Promise<string>;
}
declare global { interface Window { rune: RuneBridge } }
