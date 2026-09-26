import { spawn, ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { BuildResult, BuildStatus, BuildTarget } from '../shared/protocol';
import { ServiceClient } from './service-client';

type Prepared = { id: number; executable: string; args: string[]; cwd: string; target: BuildTarget };
export class BuildHost extends EventEmitter {
  status: BuildStatus = { id: null, state: 'idle', diagnostics: [], sources: [], output: null, log: '', elapsedMs: 0, finishMs: 0 };
  private child?: ChildProcessWithoutNullStreams;
  private starting = false;
  private preparing?: Promise<Prepared>;
  private cancelled = false;
  private done: Promise<void> = Promise.resolve();
  private killTimer?: ReturnType<typeof setTimeout>;
  private emitTimer?: ReturnType<typeof setTimeout>;
  constructor(private service: ServiceClient, readonly compiler: string) { super(); }
  get running() { return this.starting || this.status.state === 'running'; }
  reset() {
    if (this.running) throw new Error('A build is already running');
    this.status = { id: null, state: 'idle', diagnostics: [], sources: [], output: null, log: '', elapsedMs: 0, finishMs: 0 };
    this.publish();
  }
  private publish() { this.emit('status', { ...this.status }); }
  private log(text: string) {
    this.status.log += text;
    if (this.status.log.length > 128 * 1024) this.status.log = '[Earlier output truncated]\n' + this.status.log.slice(-128 * 1024);
    if (!this.emitTimer) this.emitTimer = setTimeout(() => { this.emitTimer = undefined; this.publish(); }, 100);
  }
  async start(params: { target: string; activePath?: string }, toolchain: string) {
    if (this.running) throw new Error('A build is already running');
    this.starting = true;
    let prepared: Prepared;
    try {
      this.preparing = this.service.ready.then(() => this.service.request('build/prepare', { ...params, toolchain, compiler: this.compiler }) as Promise<Prepared>);
      prepared = await this.preparing;
    } finally { this.starting = false; }
    this.cancelled = false;
    const started = performance.now();
    this.status = { id: prepared.id, state: 'running', diagnostics: [], sources: prepared.target.sources, output: null, elapsedMs: 0, finishMs: 0,
      log: 'Building ' + prepared.target.name + '\n' + prepared.target.sources.join('\n') + '\n\n' };
    this.publish();
    this.done = new Promise(resolve => {
      let failure: string | undefined;
      const child = this.child = spawn(prepared.executable, prepared.args, { cwd: prepared.cwd, stdio: 'pipe', windowsHide: true });
      child.stdin.end();
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => this.log(chunk)); child.stderr.on('data', chunk => this.log(chunk));
      child.on('error', error => { failure = 'Cannot launch compiler: ' + error.message; });
      child.on('close', (code, signal) => {
        this.child = undefined; clearTimeout(this.killTimer);
        const elapsedMs = performance.now() - started;
        const finishing = performance.now();
        void this.service.request('build/finish', { id: prepared.id, exitCode: code, cancelled: this.cancelled,
          failure: failure || (signal ? 'Compiler terminated by ' + signal : undefined) })
          .then(value => {
            this.status = { ...this.status, ...(value as BuildResult), elapsedMs, finishMs: performance.now() - finishing };
            this.log('\nBuild ' + this.status.state + ' · compiler ' + Math.round(elapsedMs) + ' ms · report/publication ' + Math.round(this.status.finishMs) + ' ms\n' + (this.status.output || '') + '\n');
          })
          .catch(error => {
            this.status = { ...this.status, state: 'failed', elapsedMs, diagnostics: [{ severity: 'error', path: '', range: null, message: String(error.message || error) }] };
            this.log('\nBuild service failure: ' + (error.message || error) + '\n');
          })
          .finally(() => { clearTimeout(this.emitTimer); this.emitTimer = undefined; this.publish(); resolve(); });
      });
    });
  }
  cancel() {
    if (!this.child) return;
    this.cancelled = true;
    const child = this.child; child.kill('SIGTERM');
    clearTimeout(this.killTimer); this.killTimer = setTimeout(() => child.kill('SIGKILL'), 1500);
  }
  async close() {
    // Wait for an in-flight preparation so quitting cannot leave a late child.
    await this.preparing?.catch(() => undefined);
    this.cancel(); await this.done;
  }
}
