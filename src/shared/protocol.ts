export type DirectoryEntry = { path: string; name: string; directory: boolean; symlink: boolean };
export type WorkspaceChanges = { root: string; directories: { path: string; entries: DirectoryEntry[]; error?: string }[] };
export type DiskState = 'same' | 'changed' | 'missing' | 'unreadable' | 'replaced';
export type Workspace = { path: string; name: string };
export type ServiceStatus = { state: 'starting' | 'ready' | 'failed'; message: string };
export type DocumentState = { path: string; revision: number; dirty: boolean };
export type DocumentSnapshot = DocumentState & { text: string; savedText?: string; bom: boolean; readOnly?: boolean };
export type RecoveryBuffer = { id: string; workspace: string; path: string; revision: number };
export type Theme = 'dark' | 'light' | 'contrast';
export type CommandInfo = { id: Command; label: string; category: string; shortcut: string; enabled: boolean };
export type CommandContext = { ready: boolean; busy: boolean; building: boolean; workspace: boolean; editor: boolean; readOnly: boolean; documents: boolean };
export type SessionSettings = { theme?: Theme | null; showExcluded?: boolean | null; target?: string | null; toolchain?: string | null };
export type SessionState = { version: 1; workspace: string | null; view: unknown; settings: SessionSettings; recovery: RecoveryBuffer[]; warnings: string[] };
export type Command = 'save' | 'save-all' | 'split' | 'close' | 'open-folder' | 'reveal' | 'quit' | 'build' | 'cancel-build' | 'close-all' | 'palette' | 'focus-explorer' | 'focus-editor' | 'focus-output' | 'focus-problems' | 'theme-dark' | 'theme-light' | 'theme-contrast' | 'zoom-in' | 'zoom-out' | 'zoom-reset';
export type Diagnostic = { severity: 'error' | 'warning'; message: string; path: string; range: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } | null };
export type BuildTarget = { name: string; sources: string[]; output: string };
export type BuildResult = { id: number; state: 'success' | 'failed' | 'cancelled' | 'stale'; diagnostics: Diagnostic[]; output: string | null; sources: string[]; cleanupWarning?: string | null };
export type BuildStatus = Omit<BuildResult, 'id' | 'state'> & { id: number | null; state: 'idle' | 'running' | BuildResult['state']; log: string; elapsedMs: number; finishMs: number };
export interface RuneBridge {
  request<T>(method: string, params?: unknown): Promise<T>;
  zoom(direction: -1 | 0 | 1): Promise<void>;
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
  restartService(): Promise<void>;
  watch(paths: string[], showExcluded: boolean): Promise<void>;
  onFilesChanged(listener: () => void): () => void;
}
declare global { interface Window { rune: RuneBridge } }
