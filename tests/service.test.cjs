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
