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
