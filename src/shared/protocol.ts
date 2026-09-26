export type DirectoryEntry = { path: string; name: string; directory: boolean; symlink: boolean };
export type Workspace = { path: string; name: string };
export type ServiceStatus = { state: 'starting' | 'ready' | 'failed'; message: string };
export type DocumentState = { path: string; revision: number; dirty: boolean };
export type DocumentSnapshot = DocumentState & { text: string; bom: boolean };
export type Command = 'save' | 'save-all' | 'split' | 'close' | 'open-folder' | 'reveal' | 'quit';
export interface RuneBridge {
  request<T>(method: string, params?: unknown): Promise<T>;
  chooseFolder(): Promise<string | null>;
  status(): Promise<ServiceStatus>;
  onStatus(listener: (status: ServiceStatus) => void): () => void;
  confirmUnsaved(path: string): Promise<'save' | 'discard' | 'cancel'>;
  onCommand(listener: (command: Command) => void): () => void;
  finishClose(): Promise<void>;
}
declare global { interface Window { rune: RuneBridge } }
