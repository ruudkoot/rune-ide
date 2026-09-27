import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { ServiceStatus } from '../shared/protocol';

export class ServiceClient extends EventEmitter {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private buffer = '';
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private closing = false;
  status: ServiceStatus = { state: 'starting', message: 'Starting Standard ML service…' };
  readonly ready: Promise<unknown>;

  constructor(vm: string, bytecode: string, stateDir?: string, defaultToolchain?: string) {
    super();
    this.child = spawn(vm, ['--heap-size', '67108864', bytecode], { stdio: 'pipe', windowsHide: true });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 4 * 1024 * 1024) return this.fail(new Error('Service response exceeded the message limit'));
      let end: number;
      while ((end = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, end); this.buffer = this.buffer.slice(end + 1);
        try {
          const reply = JSON.parse(line);
          if (reply.jsonrpc !== '2.0') throw new Error('Invalid service response');
          const item = this.pending.get(reply.id);
          if (!item) continue;
          clearTimeout(item.timer); this.pending.delete(reply.id);
          if (reply.error) item.reject(new Error(reply.error.message)); else item.resolve(reply.result);
        } catch (e) { this.fail(e instanceof Error ? e : new Error(String(e))); }
      }
    });
    this.child.stderr.on('data', (data: string) => process.stderr.write(`[SML] ${data}`));
    this.child.on('error', (error) => this.fail(error));
    this.child.stdin.on('error', (error) => { if (!this.closing) this.fail(error); });
    this.child.on('exit', (code, signal) => {
      if (!this.closing) this.fail(new Error(`SML service exited (${signal || code}). Restart the service to reconnect your editors.`));
      else {
        for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Service stopped')); }
        this.pending.clear();
      }
    });
    this.ready = this.request('initialize', { protocol: 1, stateDir, defaultToolchain, platform: process.platform }).then((value) => {
      this.status = { state: 'ready', message: 'Standard ML on Rune' }; this.emit('status', this.status); return value;
    }).catch((error) => { this.fail(error); throw error; });
    // Startup failure is also observable through status; do not leave an unhandled rejection.
    void this.ready.catch(() => undefined);
  }
  private fail(error: Error) {
    if (this.status.state === 'failed') return;
    this.status = { state: 'failed', message: error.message };
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(error); }
    this.pending.clear(); this.emit('status', this.status);
    this.child.kill();
  }
  request(method: string, params: unknown = {}): Promise<unknown> {
    if (this.status.state === 'failed') return Promise.reject(new Error(this.status.message));
    const id = ++this.nextId;
    const message = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    if (Buffer.byteLength(message) > 4 * 1024 * 1024) return Promise.reject(new Error('Request is too large'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Service request timed out: ${method}`)); }, 30_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(message, (error) => { if (error && this.pending.delete(id)) { clearTimeout(timer); reject(error); } });
    });
  }
  async close() {
    this.closing = true;
    const deadline = setTimeout(() => this.child.kill('SIGKILL'), 1500);
    try { await this.request('shutdown'); } catch { /* Already stopped. */ }
    finally {
      this.child.stdin.end(); this.child.kill(); clearTimeout(deadline);
      for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error('Application closed')); }
      this.pending.clear();
    }
  }
}
