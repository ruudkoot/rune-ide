const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createInterface } = require('node:readline');

function service(t) {
  const command = process.env.SERVICE_COMMAND ? JSON.parse(process.env.SERVICE_COMMAND) : [path.join(process.env.RUNE_ROOT || '/home/ruud/rune', 'bin/runevm'), 'build/service.rbc'];
  const child = spawn(command[0], command.slice(1));
  let id = 0; const requests = new Map(); const replies = [];
  createInterface({ input: child.stdout }).on('line', line => { const value = JSON.parse(line); replies.push(value); requests.get(value.id)?.(value); requests.delete(value.id); });
  const ask = (method, params = {}) => new Promise((resolve) => { const next = ++id; requests.set(next, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: next, method, params }) + '\n'); });
  t.after(() => child.kill());
  return { child, ask, replies };
}
test('service handshakes, survives invalid methods, and round-trips Unicode', { timeout: 5000 }, async t => {
  const { ask } = service(t);
  assert.equal((await ask('ping')).error.code, -32002);
  assert.equal((await ask('initialize', { protocol: 9 })).error.code, -32001);
  assert.equal((await ask('initialize', { protocol: 1 })).result.protocol, 1);
  const value = { text: 'λ 🙂\nline\r\n"quoted"', number: -123, values: [true, false, null, 1.25e10] };
  assert.deepEqual((await ask('ping', value)).result, value);
  assert.equal((await ask('missing')).error.code, -32601);
  assert.equal((await ask('ping', { alive: true })).result.alive, true);
});
test('fragmented/coalesced frames and escaped surrogate pairs', { timeout: 5000 }, async t => {
  const { child, ask, replies } = service(t);
  await ask('initialize', { protocol: 1 });
  child.stdin.write('{"jsonrpc":"2.0","id":71,"method":"pi');
  child.stdin.write('ng","params":"\\ud83d\\ude42"}\r\n{broken}\n');
  await ask('ping', {});
  assert.equal(replies.find(x => x.id === 71).result, '🙂');
  assert.equal(replies.find(x => x.id === null).error.code, -32700);
});
test('SML workspace lists lazily, filters generated files, and confines paths', { timeout: 5000 }, async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-ide-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  mkdirSync(path.join(folder, 'src')); mkdirSync(path.join(folder, '.git'));
  writeFileSync(path.join(folder, 'λ.sml'), 'val x = 1\n');
  symlinkSync(folder, path.join(folder, 'cycle'));
  const { ask } = service(t); await ask('initialize', { protocol: 1 });
  assert.equal((await ask('workspace/open', { path: folder })).result.path, folder);
  const entries = (await ask('workspace/list', { path: folder })).result;
  assert.deepEqual(entries.map(x => x.name), ['cycle', 'src', 'λ.sml']);
  assert.equal(entries[0].symlink, true);
  assert.equal((await ask('workspace/list', { path: '/tmp' })).error.code, -32010);
});

test('document edits use UTF-16 revisions and preserve BOM, CRLF and permissions', { timeout: 5000 }, async t => {
  const { readFileSync, statSync, chmodSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune documents λ '));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'hello λ.sml');
  const initial = '(* 🙂 λ *)\r\nval x = 1\r\n';
  writeFileSync(file, '\ufeff' + initial); chmodSync(file, 0o640);
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: folder });
  const doc = (await ask('document/open', { path: file })).result;
  assert.equal(doc.text, initial); assert.equal(doc.bom, true);
  assert.equal((await ask('document/change', { path: file, revision: 0, changes: [{ offset: 4, length: 0, text: 'x' }] })).error.code, -32602, 'split surrogate rejected');
  const changed = (await ask('document/change', { path: file, revision: 0, changes: [{ offset: initial.indexOf('1'), length: 1, text: '42' }, { offset: 3, length: 2, text: '🦊' }] })).result;
  assert.equal(changed.revision, 1); assert.equal(changed.dirty, true);
  assert.equal((await ask('document/save', { path: file, revision: 0 })).error.code, -32020);
  assert.equal((await ask('document/close', { path: file, revision: 1 })).error.code, -32020);
  assert.equal((await ask('workspace/open', { path: folder })).error.code, -32020);
  assert.equal((await ask('document/save', { path: file, revision: 1 })).result.dirty, false);
  assert.equal(readFileSync(file, 'utf8'), '\ufeff' + initial.replace('🙂', '🦊').replace('1', '42'));
  assert.equal(statSync(file).mode & 0o777, 0o640);
  assert.equal((await ask('document/close', { path: file, revision: 1 })).result, null);
  assert.equal((await ask('document/open', { path: file })).result.revision, 0);
});

test('external changes and failed writes retain the editable document', { timeout: 5000 }, async t => {
  const { readFileSync, chmodSync, readdirSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-conflict-'));
  t.after(() => { chmodSync(folder, 0o700); rmSync(folder, { recursive: true, force: true }); });
  const file = path.join(folder, 'file.sml'); writeFileSync(file, 'val x = 1\n');
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: folder });
  await ask('document/open', { path: file });
  await ask('document/change', { path: file, revision: 0, changes: [{ offset: 8, length: 1, text: '2' }] });
  writeFileSync(file, 'external\n');
  assert.match((await ask('document/save', { path: file, revision: 1 })).error.message, /changed on disk/);
  assert.equal(readFileSync(file, 'utf8'), 'external\n');
  assert.equal((await ask('document/open', { path: file })).result.text, 'val x = 2\n');
  await ask('document/close', { path: file, revision: 1, discard: true });
  assert.equal((await ask('document/open', { path: file })).result.text, 'external\n');
  await ask('document/change', { path: file, revision: 0, changes: [{ offset: 0, length: 8, text: 'edited' }] });
  chmodSync(folder, 0o500);
  assert.ok((await ask('document/save', { path: file, revision: 1 })).error);
  chmodSync(folder, 0o700);
  assert.equal((await ask('document/list')).result[0].dirty, true);
  assert.deepEqual(readdirSync(folder), ['file.sml']);
});

test('unsupported files fail explicitly and a large tree stays lazy', { timeout: 5000 }, async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-files-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  for (let i = 0; i < 1000; i++) mkdirSync(path.join(folder, `dir${i}`));
  writeFileSync(path.join(folder, 'binary'), Buffer.from([0, 255]));
  writeFileSync(path.join(folder, 'mixed'), 'a\r\nb\n');
  writeFileSync(path.join(folder, 'large'), 'a'.repeat(512 * 1024 + 1));
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: folder });
  const rows = (await ask('workspace/list', { path: folder })).result;
  assert.equal(rows.length, 1003); assert.equal(rows[0].directory, true); assert.equal(rows[0].children, undefined);
  for (const name of ['binary', 'mixed', 'large', 'dir0']) assert.ok((await ask('document/open', { path: path.join(folder, name) })).error);
});

test('real Rune builds preserve source order and report syntax, type and warning spans', { timeout: 30000 }, async t => {
  const { readFileSync, existsSync } = require('node:fs'); const { spawnSync } = require('node:child_process');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-build λ '));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const a = path.join(folder, 'a.sml'), b = path.join(folder, 'b.sml');
  writeFileSync(a, 'structure A = struct val n = 42 end\n');
  writeFileSync(b, 'structure B = struct val n = A.n end\n');
  writeFileSync(path.join(folder, 'sources.txt'), '# ordered sources\na.sml\nb.sml\n');
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: folder });
  const toolchain = process.env.RUNE_ROOT || '/home/ruud/rune';
  const compiler = path.resolve('build/compiler.rbc');
  const prepare = async () => {
    const reply = await ask('build/prepare', { target: 'workspace', toolchain, compiler });
    assert.ok(reply.result, JSON.stringify(reply)); return reply.result;
  };
  const build = async () => {
    const job = await prepare();
    const child = spawnSync(job.executable, job.args, { cwd: job.cwd, encoding: 'utf8' });
    assert.ifError(child.error);
    const reply = await ask('build/finish', { id: job.id, exitCode: child.status });
    assert.ok(reply.result, JSON.stringify(reply));
    assert.equal(reply.result.cleanupWarning, null);
    assert.equal(existsSync(path.dirname(job.args[3])), false, 'completed build releases its scratch directory');
    return reply.result;
  };
  assert.deepEqual((await ask('build/targets')).result[0].sources, [a, b]);
  const valid = await build(); assert.equal(valid.state, 'success'); assert.equal(valid.diagnostics.length, 0);
  const cli = path.join(folder, 'cli.rbc');
  const cliResult = spawnSync(path.join(toolchain, 'bin/rune'), ['-o', cli, a, b], { encoding: 'utf8' });
  assert.equal(cliResult.status, 0, cliResult.stderr);
  assert.deepEqual(readFileSync(valid.output), readFileSync(cli));
  writeFileSync(path.join(folder, 'sources.txt'), 'b.sml\na.sml\n');
  const order = await build(); assert.equal(order.state, 'failed'); assert.equal(order.diagnostics[0].path, b);
  writeFileSync(path.join(folder, 'sources.txt'), 'a.sml\nb.sml\n');
  const typed = 'structure A = struct (* 🙂 λ *) val x : int = "bad" end\n';
  writeFileSync(a, typed);
  const bad = await build(); assert.equal(bad.state, 'failed');
  assert.equal(bad.diagnostics[0].range.startColumn, typed.indexOf('x : int') + 1, 'columns count UTF-16 units');
  assert.equal((await ask('diagnostic/open', { index: 0 })).result.text, typed);
  await ask('document/close', { path: a, revision: 0 });
  writeFileSync(a, 'structure A = struct val n = end\n');
  assert.equal((await build()).diagnostics[0].severity, 'error');
  writeFileSync(a, 'structure A = struct val n = 42 fun head (x :: xs) = x end\n');
  const warning = await build(); assert.equal(warning.state, 'success');
  assert.ok(warning.diagnostics.some(d => d.severity === 'warning'));
});

test('build publication rejects stale, cancelled, malformed and failed processes', { timeout: 10000 }, async t => {
  const { readFileSync, existsSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-build-policy-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'main.sml'); writeFileSync(file, 'val n = 1\n');
  writeFileSync(path.join(folder, '.rune-ide.json'), JSON.stringify({ version: 1, targets: [{ name: 'app', sources: ['main.sml'], output: 'app.rbc' }] }));
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: folder });
  const params = { target: 'app', toolchain: process.env.RUNE_ROOT || '/home/ruud/rune', compiler: path.resolve('build/compiler.rbc') };
  const prepare = async () => { const r = await ask('build/prepare', params); assert.ok(r.result, JSON.stringify(r)); return r.result; };
  const finish = async (job, extra = {}) => {
    const result = (await ask('build/finish', { id: job.id, exitCode: 0, ...extra })).result;
    assert.equal(result.cleanupWarning, null);
    assert.equal(existsSync(path.dirname(job.args[3])), false, 'failed/cancelled/stale builds release scratch files');
    return result;
  };
  let job = await prepare();
  assert.equal((await ask('build/prepare', params)).error.code, -32030);
  assert.equal((await ask('workspace/open', { path: folder })).error.code, -32030);
  assert.equal((await ask('build/finish', { id: job.id + 1, exitCode: 0 })).error.code, -32030);
  writeFileSync(job.args[3], '{bad');
  assert.equal((await finish(job)).state, 'failed');
  job = await prepare(); assert.equal((await finish(job, { cancelled: true })).state, 'cancelled');
  job = await prepare(); assert.match((await finish(job, { failure: 'Cannot launch compiler: ENOENT' })).diagnostics[0].message, /Cannot launch/);
  job = await prepare(); assert.match((await finish(job, { exitCode: null, failure: 'Compiler terminated by SIGSEGV' })).diagnostics[0].message, /SIGSEGV/);
  job = await prepare();
  writeFileSync(job.args[3], JSON.stringify({ version: 1, success: true, diagnostics: [] }));
  const output = job.args[job.args.indexOf('-o') + 1]; writeFileSync(output, 'new artifact');
  writeFileSync(path.join(folder, '.rune-ide/app.rbc'), 'previous artifact');
  writeFileSync(file, 'val n = 2\n');
  assert.equal((await finish(job)).state, 'stale');
  assert.equal(readFileSync(path.join(folder, '.rune-ide/app.rbc'), 'utf8'), 'previous artifact');
  job = await prepare();
  const winPath = 'C:\\work\\hello λ.sml';
  writeFileSync(job.args[3], JSON.stringify({ version: 1, success: false, diagnostics: [{ severity: 'error', message: 'fixture', path: winPath, range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 4 } }] }));
  assert.equal((await finish(job, { exitCode: 1 })).diagnostics[0].path, winPath);
  job = await prepare();
  writeFileSync(job.args[3], JSON.stringify({ version: 99, success: true, diagnostics: [] }));
  assert.match((await finish(job)).diagnostics[0].message, /incompatible diagnostic report/);
  job = await prepare();
  writeFileSync(job.args[3], JSON.stringify({ version: 1, success: true, diagnostics: [] }));
  assert.match((await finish(job, { exitCode: 1 })).diagnostics[0].message, /disagrees/);
  const fakeToolchain = path.join(folder, 'toolchain');
  mkdirSync(fakeToolchain); mkdirSync(path.join(fakeToolchain, 'bin'));
  symlinkSync(path.join(params.toolchain, 'bin/runevm'), path.join(fakeToolchain, 'bin/runevm'));
  assert.match((await ask('build/prepare', { ...params, toolchain: fakeToolchain })).error.message, /basis\/MANIFEST/);
  assert.ok((await ask('build/prepare', { ...params, compiler: path.join(folder, 'missing.rbc') })).error);
  const missing = (await ask('build/prepare', { ...params, toolchain: folder })).error;
  assert.match(missing.message, /runevm/);
});

test('build cleanup retains unknown contents and refuses replaced directories and symlinks', { timeout: 10000 }, async t => {
  const { existsSync, readFileSync, renameSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-build-cleanup-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const workspace = path.join(folder, 'workspace'); mkdirSync(workspace);
  const file = path.join(workspace, 'main.sml'); writeFileSync(file, 'val n = 1\n');
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: workspace });
  const params = { target: 'active-file', activePath: file, toolchain: process.env.RUNE_ROOT || '/home/ruud/rune', compiler: path.resolve('build/compiler.rbc') };
  const prepare = async () => { const r = await ask('build/prepare', params); assert.ok(r.result, JSON.stringify(r)); return r.result; };
  const finish = async (job, cancelled = false) => (await ask('build/finish', { id: job.id, exitCode: 0, cancelled })).result;
  let job = await prepare(); let work = path.dirname(job.args[3]);
  const other = await prepareOther();
  async function prepareOther() {
    const peer = service(t); await peer.ask('initialize', { protocol: 1 }); await peer.ask('workspace/open', { path: workspace });
    const result = await peer.ask('build/prepare', params); assert.ok(result.result, JSON.stringify(result));
    return { ...peer, job: result.result };
  }
  const output = job.args[job.args.indexOf('-o') + 1]; writeFileSync(output, 'published program');
  writeFileSync(job.args[3], JSON.stringify({ version: 1, success: true, diagnostics: [] }));
  writeFileSync(path.join(work, 'keep.txt'), 'unrelated content');
  const result = await finish(job);
  assert.equal(result.state, 'success'); assert.match(result.cleanupWarning, /Cannot clean/);
  assert.equal(readFileSync(result.output, 'utf8'), 'published program');
  assert.equal(readFileSync(path.join(work, 'keep.txt'), 'utf8'), 'unrelated content');
  assert.equal(existsSync(job.args[3]), false);
  assert.ok(existsSync(path.dirname(other.job.args[3])), 'another service owns its active scratch directory');
  assert.equal((await other.ask('build/finish', { id: other.job.id, exitCode: null, cancelled: true })).result.cleanupWarning, null);

  job = await prepare(); work = path.dirname(job.args[3]);
  renameSync(work, work + '-original'); mkdirSync(work); writeFileSync(job.args[3], 'replacement directory contents');
  assert.match((await finish(job, true)).cleanupWarning, /identity changed/);
  assert.equal(readFileSync(job.args[3], 'utf8'), 'replacement directory contents');

  job = await prepare(); work = path.dirname(job.args[3]);
  rmSync(work, { recursive: true });
  const external = path.join(folder, 'external'); mkdirSync(external); writeFileSync(path.join(external, 'diagnostics.json'), 'external content');
  symlinkSync(external, work);
  assert.match((await finish(job, true)).cleanupWarning, /Cannot clean/);
  assert.equal(readFileSync(path.join(external, 'diagnostics.json'), 'utf8'), 'external content');
});

test('journalled edits survive termination, preserve conflicts and require an explicit recovery decision', { timeout: 10000 }, async t => {
  const { readFileSync, readdirSync, statSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-recovery-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const workspace = path.join(folder, 'workspace'), stateDir = path.join(folder, 'state'); mkdirSync(workspace);
  const file = path.join(workspace, 'hello λ.sml'); writeFileSync(file, '\ufeffval x = 1\r\n');
  const start = async () => { const s = service(t); const reply = await s.ask('initialize', { protocol: 1, stateDir }); assert.ok(reply.result, JSON.stringify(reply)); return s; };
  const first = await start();
  await first.ask('workspace/open', { path: workspace }); await first.ask('document/open', { path: file });
  await first.ask('session/save', { view: { version: 1, fixture: 'layout' }, settings: { showExcluded: true, target: 'app' } });
  const change = await first.ask('document/change', { path: file, revision: 0, changes: [{ offset: 8, length: 1, text: '42 (* 🙂 *)' }] });
  assert.equal(change.result.revision, 1);
  const journal = readdirSync(stateDir).find(name => name.startsWith('buffer-'));
  assert.ok(journal); assert.equal(statSync(path.join(stateDir, journal)).mode & 0o777, 0o600);
  first.child.kill('SIGKILL'); await new Promise(resolve => first.child.once('exit', resolve));
  writeFileSync(file, 'val external = 99\n');
  const second = await start();
  const session = (await second.ask('session/load')).result;
  assert.equal(session.workspace, workspace); assert.equal(session.view.fixture, 'layout'); assert.equal(session.settings.showExcluded, true);
  assert.equal(session.recovery.length, 1);
  await second.ask('workspace/open', { path: workspace });
  assert.match((await second.ask('document/open', { path: file })).error.message, /recoverable edits/);
  const restored = (await second.ask('recovery/restore', { id: session.recovery[0].id })).result;
  assert.equal(restored.text, 'val x = 42 (* 🙂 *)\r\n'); assert.equal(restored.bom, true); assert.equal(restored.dirty, true);
  assert.equal(restored.savedText, 'val x = 1\r\n');
  assert.equal((await second.ask('session/load')).result.recovery.length, 0);
  assert.match((await second.ask('document/save', { path: file, revision: 0 })).error.message, /changed on disk/);
  assert.equal(readFileSync(file, 'utf8'), 'val external = 99\n');
  assert.ok((await second.ask('recovery/discard', { id: session.recovery[0].id })).error);
  await second.ask('document/close', { path: file, revision: 0, discard: true });
  assert.equal(readdirSync(stateDir).filter(name => name.startsWith('buffer-')).length, 0);
  const attached = (await second.ask('document/attach', { path: file, text: 'val external = 99\n', savedText: 'val x = 1\r\n', bom: false })).result;
  assert.equal(attached.dirty, false); assert.equal(attached.savedText, 'val external = 99\n');
  assert.equal(readdirSync(stateDir).filter(name => name.startsWith('buffer-')).length, 0);
});

test('recovery write failure leaves the acknowledged revision intact; corrupt state is preserved', { timeout: 10000 }, async t => {
  const { chmodSync, readFileSync, readdirSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-state-failure-'));
  const stateDir = path.join(folder, 'state');
  t.after(() => { if (require('node:fs').existsSync(stateDir)) chmodSync(stateDir, 0o700); rmSync(folder, { recursive: true, force: true }); });
  const file = path.join(folder, 'main.sml'); writeFileSync(file, 'val n = 0\n');
  const first = service(t); await first.ask('initialize', { protocol: 1, stateDir });
  await first.ask('workspace/open', { path: folder }); await first.ask('document/open', { path: file });
  const other = path.join(folder, 'other'); mkdirSync(other);
  chmodSync(stateDir, 0o500);
  assert.ok((await first.ask('workspace/open', { path: other })).error);
  assert.equal((await first.ask('document/list')).result[0].path, file);
  assert.equal((await first.ask('session/load')).result.workspace, folder);
  assert.ok((await first.ask('document/change', { path: file, revision: 0, changes: [{ offset: 8, length: 1, text: '1' }] })).error);
  const still = (await first.ask('document/open', { path: file })).result;
  assert.equal(still.revision, 0); assert.equal(still.text, 'val n = 0\n');
  chmodSync(stateDir, 0o700);
  assert.ok((await first.ask('document/change', { path: file, revision: 0, changes: [{ offset: 8, length: 1, text: '1' }] })).result);
  first.child.kill('SIGKILL'); await new Promise(resolve => first.child.once('exit', resolve));
  writeFileSync(path.join(stateDir, 'session.json'), '{corrupt');
  const second = service(t); await second.ask('initialize', { protocol: 1, stateDir });
  const session = (await second.ask('session/load')).result;
  assert.equal(session.recovery.length, 1); assert.equal(session.warnings.length, 1);
  const backup = readdirSync(stateDir).find(name => name.startsWith('session.json.unreadable'));
  assert.equal(readFileSync(path.join(stateDir, backup), 'utf8'), '{corrupt');
  await second.ask('recovery/discard', { id: session.recovery[0].id });
  assert.equal((await second.ask('session/load')).result.recovery.length, 0);
});

test('recovery quotas preserve excess records and unavailable paths without acknowledging new edits', { timeout: 10000 }, async t => {
  const { readdirSync, readFileSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-recovery-bounds-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const stateDir = path.join(folder, 'state'); mkdirSync(stateDir);
  for (let i = 1; i <= 65; i++) writeFileSync(path.join(stateDir, `buffer-${i}.json`), JSON.stringify({
    version: 1, workspace: folder, path: path.join(folder, `missing-${i}.sml`), text: 'val n = 1', saved: 'val n = 0', revision: 1, bom: false,
  }));
  const file = path.join(folder, 'active.sml'); writeFileSync(file, 'val n = 0');
  const first = service(t); assert.ok((await first.ask('initialize', { protocol: 1, stateDir })).result);
  let session = (await first.ask('session/load')).result;
  assert.equal(session.recovery.length, 64); assert.match(session.warnings.join(' '), /additional records are preserved/);
  await first.ask('workspace/open', { path: folder });
  assert.ok((await first.ask('recovery/restore', { id: session.recovery[0].id })).error);
  assert.equal((await first.ask('session/load')).result.recovery.length, 64);
  await first.ask('document/open', { path: file });
  assert.match((await first.ask('document/change', { path: file, revision: 0, changes: [{ offset: 8, length: 1, text: '1' }] })).error.message, /storage is full/);
  assert.equal((await first.ask('document/open', { path: file })).result.text, 'val n = 0');
  assert.equal(readFileSync(file, 'utf8'), 'val n = 0');
  assert.equal(readdirSync(stateDir).filter(n => n.startsWith('buffer-')).length, 65);
  await first.ask('recovery/discard', { id: session.recovery[0].id });
  const exit = new Promise(resolve => first.child.once('exit', resolve)); await first.ask('shutdown'); await exit;
  const second = service(t); assert.ok((await second.ask('initialize', { protocol: 1, stateDir })).result);
  session = (await second.ask('session/load')).result;
  assert.equal(session.recovery.length, 64); assert.equal(session.warnings.length, 0);
  // Losing the whole workspace is also a recoverable error, not a deletion policy.
  assert.ok((await second.ask('workspace/open', { path: path.join(folder, 'gone') })).error);
  assert.equal((await second.ask('session/load')).result.recovery.length, 64);
});

test('filesystem rescans coalesce unchanged directories and reloads preserve conflicting edits', { timeout: 10000 }, async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-watch-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const file = path.join(folder, 'main.sml'); writeFileSync(file, 'val n = 0\n');
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: folder });
  assert.deepEqual((await ask('workspace/watch', { paths: [folder, folder], showExcluded: false })).result, [folder]);
  assert.equal((await ask('workspace/changes')).result.directories.length, 1);
  assert.equal((await ask('workspace/changes')).result.directories.length, 0);
  writeFileSync(path.join(folder, 'new.sml'), '');
  assert.equal((await ask('workspace/changes')).result.directories[0].entries.length, 2);
  assert.ok((await ask('workspace/watch', { paths: ['/tmp'] })).error);
  await ask('document/open', { path: file });
  writeFileSync(file, '\ufeffval n = 1\r\n');
  assert.equal((await ask('document/check', { path: file, revision: 0 })).result.state, 'changed');
  const loaded = (await ask('document/reload', { path: file, revision: 0 })).result;
  assert.equal(loaded.text, 'val n = 1\r\n'); assert.equal(loaded.bom, true); assert.equal(loaded.revision, 1);
  await ask('document/change', { path: file, revision: 1, changes: [{ offset: 8, length: 1, text: '2' }] });
  writeFileSync(file, 'val n = 3\n');
  assert.ok((await ask('document/reload', { path: file, revision: 2 })).error);
  assert.equal((await ask('document/open', { path: file })).result.text, 'val n = 2\r\n');
  assert.ok((await ask('document/reload', { path: file, revision: 1, discard: true })).error);
  const discarded = (await ask('document/reload', { path: file, revision: 2, discard: true })).result;
  assert.equal(discarded.text, 'val n = 3\n'); assert.equal(discarded.dirty, false);
  rmSync(file); assert.equal((await ask('document/check', { path: file, revision: 3 })).result.state, 'missing');
  assert.ok((await ask('document/reload', { path: file, revision: 3 })).error);
});

test('SML file operations protect open edits, collisions and roots, and retain deleted contents in trash', { timeout: 10000 }, async t => {
  const { readFileSync, existsSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-files-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: folder });
  const dir = (await ask('file/create', { parent: folder, name: 'src λ', directory: true })).result.path;
  const file = (await ask('file/create', { parent: dir, name: 'main.sml' })).result.path;
  assert.ok((await ask('file/create', { parent: dir, name: 'main.sml' })).error);
  assert.ok((await ask('file/create', { parent: folder, name: '../outside' })).error);
  assert.ok((await ask('file/delete', { path: folder })).error);
  symlinkSync(dir, path.join(folder, 'link'));
  assert.ok((await ask('file/delete', { path: path.join(folder, 'link') })).error);
  await ask('document/open', { path: file });
  await ask('document/change', { path: file, revision: 0, changes: [{ offset: 0, length: 0, text: 'val n = 42\n' }] });
  assert.match((await ask('file/rename', { path: dir, name: 'renamed' })).error.message, /unsaved/);
  assert.match((await ask('file/delete', { path: dir })).error.message, /unsaved/);
  await ask('document/save', { path: file, revision: 1 });
  const renamed = (await ask('file/rename', { path: dir, name: 'renamed' })).result.path;
  assert.equal((await ask('document/list')).result[0].path, path.join(renamed, 'main.sml'));
  assert.equal((await ask('document/open', { path: path.join(renamed, 'main.sml') })).result.revision, 1);
  const trashed = (await ask('file/delete', { path: renamed })).result;
  assert.equal(existsSync(renamed), false); assert.equal(readFileSync(path.join(trashed.trashPath, 'main.sml'), 'utf8'), 'val n = 42\n');
  assert.deepEqual((await ask('document/list')).result, []);
  assert.ok((await ask('file/delete', { path: path.join(folder, '.rune-ide') })).error);
});

test('a removed clean file is journalled and its recovery copy is exclusive and preserves BOM', { timeout: 10000 }, async t => {
  const { readFileSync } = require('node:fs');
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-missing-copy-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  const stateDir = path.join(folder, 'state'), file = path.join(folder, 'gone.sml');
  const source = '\ufeffval smile = "🙂"\r\n'; writeFileSync(file, source);
  const first = service(t); await first.ask('initialize', { protocol: 1, stateDir }); await first.ask('workspace/open', { path: folder });
  await first.ask('document/open', { path: file }); rmSync(file);
  assert.equal((await first.ask('document/check', { path: file, revision: 0 })).result.state, 'missing');
  const exit = new Promise(resolve => first.child.once('exit', resolve)); await first.ask('shutdown'); await exit;
  const second = service(t); await second.ask('initialize', { protocol: 1, stateDir }); await second.ask('workspace/open', { path: folder });
  const record = (await second.ask('session/load')).result.recovery[0]; assert.equal(record.path, file);
  const copy = (await second.ask('file/copy', { recoveryId: record.id, parent: folder, name: 'rescued.sml' })).result;
  assert.equal(readFileSync(copy.path, 'utf8'), source);
  assert.ok((await second.ask('file/copy', { recoveryId: record.id, parent: folder, name: 'rescued.sml' })).error);
  assert.equal(readFileSync(copy.path, 'utf8'), source);
  assert.equal((await second.ask('session/load')).result.recovery.length, 1);
});

test('SML commands filter by all query terms, gate context and validate themes', { timeout: 5000 }, async t => {
  const { ask } = service(t); await ask('initialize', { protocol: 1, defaultToolchain: '/bundled' });
  const rows = (await ask('commands/list')).result;
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.equal(rows.find(row => row.id === 'save').enabled, false);
  const context = { ready: true, workspace: true, editor: true, readOnly: true, documents: true };
  assert.equal((await ask('commands/list', { query: ' SAVE File ', context })).result.length, 2);
  assert.equal((await ask('commands/list', { query: 'save', context })).result.find(row => row.id === 'save').enabled, false);
  assert.equal((await ask('commands/list', { query: 'save', context: { ...context, readOnly: false } })).result.find(row => row.id === 'save').enabled, true);
  assert.equal((await ask('commands/list', { query: 'Save Build', context: { ...context, busy: true } })).result[0].enabled, false);
  assert.equal((await ask('commands/list', { query: 'x'.repeat(257) })).error.code, -32602);
  assert.equal((await ask('session/save', { view: null, settings: { theme: 'unknown' } })).error.code, -32040);
  assert.equal((await ask('session/save', { view: null, settings: { theme: 'light', toolchain: '/bundled' } })).result, null);
  await ask('session/toolchain', { path: '/external' });
  const session = (await ask('session/load')).result;
  assert.equal(session.settings.theme, 'light'); assert.equal(session.settings.toolchain, '/external');
});

test('open document capacity recovers after close without evicting text', { timeout: 10000 }, async t => {
  const folder = mkdtempSync(path.join(tmpdir(), 'rune-capacity-')); t.after(() => rmSync(folder, { recursive: true, force: true }));
  const { ask } = service(t); await ask('initialize', { protocol: 1 }); await ask('workspace/open', { path: folder });
  for (let n = 0; n < 129; n++) {
    const file = path.join(folder, n + '.sml'); writeFileSync(file, 'val x = 1\n');
    const reply = await ask('document/open', { path: file });
    if (n < 128) assert.ok(reply.result); else assert.match(reply.error.message, /128 documents/);
  }
  assert.equal((await ask('document/list')).result.length, 128);
  await ask('document/close', { path: path.join(folder, '0.sml'), revision: 0 });
  assert.ok((await ask('document/open', { path: path.join(folder, '128.sml') })).result);
});
