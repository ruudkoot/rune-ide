const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
// Load the actual host adapters, without adding a second production build.
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { BuildHost } = require('../src/host/build-host.ts');
const { ServiceClient } = require('../src/host/service-client.ts');

function fakeService(code, executable = process.execPath) {
  const calls = [];
  return { calls, ready: Promise.resolve(), request: async (method, params) => {
    calls.push([method, params]);
    if (method === 'build/prepare') return { id: 7, executable, args: ['-e', code], cwd: process.cwd(), target: { name: 'fixture', sources: [], output: 'out.rbc' } };
    return { id: 7, state: params.cancelled ? 'cancelled' : params.failure ? 'failed' : 'success', diagnostics: params.failure ? [{ severity: 'error', path: '', range: null, message: params.failure }] : [], output: null, sources: [] };
  } };
}
test('compiler host drains both pipes, bounds logs and cancels the child', { timeout: 10000 }, async () => {
  const service = fakeService('process.stdout.write("a".repeat(300000)); process.stderr.write("b".repeat(300000)); setInterval(() => {}, 1000)');
  const host = new BuildHost(service, 'unused');
  await host.start({ target: 'fixture' }, 'unused');
  await new Promise(resolve => { const onStatus = status => { if (status.log.includes('truncated')) { host.off('status', onStatus); resolve(); } }; host.on('status', onStatus); });
  host.cancel(); await host.close();
  assert.equal(host.status.state, 'cancelled'); assert.ok(host.status.log.length < 132000);
  assert.equal(service.calls.at(-1)[1].cancelled, true);
});
test('launch errors and compiler crashes become failures', { timeout: 10000 }, async () => {
  for (const service of [fakeService('', '/no-such-rune-ide-executable'), fakeService('process.kill(process.pid, "SIGKILL")')]) {
    const host = new BuildHost(service, 'unused'); await host.start({ target: 'fixture' }, 'unused');
    await new Promise(resolve => { const onStatus = status => { if (status.state !== 'running') { host.off('status', onStatus); resolve(); } }; host.on('status', onStatus); });
    assert.equal(host.status.state, 'failed'); assert.ok(host.status.diagnostics.length > 0);
  }
});
test('service startup failure rejects requests and closes promptly', { timeout: 5000 }, async () => {
  const service = new ServiceClient('/no-such-rune-ide-service', 'unused');
  await assert.rejects(service.ready); await assert.rejects(service.request('ping'));
  await service.close(); assert.equal(service.status.state, 'failed');
});
test('quit waits for preparation and cancels a late compiler child', { timeout: 5000 }, async () => {
  const service = fakeService('setInterval(() => {}, 1000)');
  let ready; service.ready = new Promise(resolve => { ready = resolve; });
  const host = new BuildHost(service, 'unused');
  const start = host.start({ target: 'fixture' }, 'unused');
  const closing = host.close(); ready();
  await start; await closing;
  assert.equal(host.status.state, 'cancelled');
});
