export type DirectoryEntry = { path: string; name: string; directory: boolean; symlink: boolean };
export type Workspace = { path: string; name: string };
export type ServiceStatus = { state: 'starting' | 'ready' | 'failed'; message: string };
export interface RuneBridge {
  request<T>(method: string, params?: unknown): Promise<T>;
  chooseFolder(): Promise<string | null>;
  status(): Promise<ServiceStatus>;
  onStatus(listener: (status: ServiceStatus) => void): () => void;
}
declare global { interface Window { rune: RuneBridge } }
