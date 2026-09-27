// Native Windows acceptance, launched using the packaged Electron's Node mode.
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'Rune IDE λ '));
const folder = path.join(work, 'source files'); fs.mkdirSync(folder);
const file = path.join(folder, 'hello λ.sml');
fs.writeFileSync(file, '\ufeffval _ = print "Windows Rune\\n"\r\n');
fs.writeFileSync(path.join(folder, 'sources.txt'), 'hello λ.sml\n');
const env = { ...process.env, RUNE_IDE_USER_DATA: path.join(work, 'profile'), RUNE_IDE_TEST_BACKGROUND: '1', PATH: process.env.SystemRoot + '\\System32' };
delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT;
const wire = value => '/' + value.replaceAll('\\', '/');
const executablePath = process.env.RUNE_IDE_WINDOWS_EXE;
const results = path.join(root, 'test-results-windows'); fs.mkdirSync(results, { recursive: true });
let app;
let page;
const errors = [];
async function launch() {
  app = await electron.launch({ executablePath, env, cwd: work, timeout: 60_000 });
  page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByText('SML service connected')).toBeVisible({ timeout: 30_000 });
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()), false);
}
async function source(text) {
  const editor = page.getByRole('textbox', { name: 'Source editor ' + wire(file), exact: true });
  await editor.focus(); await page.keyboard.press('Control+A'); await page.keyboard.insertText(text);
  await expect(page.getByText('1 unsaved · Rune')).toBeVisible();
}
async function build(state) {
  const previous = await page.evaluate(() => window.rune.buildStatus().then(value => value.id || 0));
  await page.getByRole('button', { name: 'Save and Build', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.rune.buildStatus().then(value => value.id || 0)), { timeout: 15000 }).toBeGreaterThan(previous);
  await expect(page.locator('.build-state')).toHaveText('Build ' + state, { timeout: 60_000 });
}
(async () => {
  const started = Date.now();
  try {
    await launch();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await page.getByRole('row', { name: 'hello λ.sml', exact: true }).dblclick();
    await expect(page.locator('[data-document] .monaco-editor')).toBeVisible();
    await source('val _ = print "Windows Rune\\n"\r\n(* 🙂 saved *)\r\n');
    await page.keyboard.press('Control+S');
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('(* 🙂 saved *)');
    assert.ok(fs.readFileSync(file, 'utf8').startsWith('\ufeff'));
    await build('failed');
    await expect(page.locator('.problem-row').first()).toContainText('unexpected character');
    // Rune currently rejects a BOM. Preserve it during editing, expose its
    // compiler error, then remove it externally for the successful build case.
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').slice(1));
    await expect.poll(() => page.evaluate(file => window.rune.request('document/open', { path: file }).then(doc => doc.bom), wire(file)), { timeout: 15000 }).toBe(false);
    await build('success');
    const vm = path.join(path.dirname(executablePath), 'resources/toolchain/bin/runevm.exe');
    assert.equal(execFileSync(vm, [path.join(folder, '.rune-ide/workspace.rbc')], { env, encoding: 'utf8', windowsHide: true }).replaceAll('\r', ''), 'Windows Rune\n');
    await source('val broken : int = "wrong"\r\n'); await build('failed');
    await expect(page.locator('.problem-row').first()).toBeVisible();
    assert.equal(await page.evaluate(() => window.rune.buildStatus().then(value => value.diagnostics[0].path)), wire(file));
    await page.locator('.problem-row').first().click();
    await source('val fixed = 42\r\n'); await build('success');
    // Native file notifications, clean reload and conflict protection.
    fs.writeFileSync(file, 'val external = 7\r\n');
    await expect.poll(() => page.evaluate(file => window.rune.request('document/open', { path: file }).then(doc => doc.text), wire(file)), { timeout: 15000 }).toBe('val external = 7\r\n');
    await source('val retained = 8\r\n'); fs.writeFileSync(file, 'val outside = 9\r\n');
    await expect(page.locator('.disk-banner')).toBeVisible();
    await page.getByRole('button', { name: 'Save a copy', exact: true }).first().click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('retained.sml');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => fs.readFileSync(path.join(folder, 'retained.sml'), 'utf8')).toContain('val retained');
    assert.equal(fs.readFileSync(file, 'utf8'), 'val outside = 9\r\n');
    const collision = await page.evaluate(async folder => {
      try { await window.rune.request('file/create', { parent: folder, name: 'RETAINED.sml', directory: false }); return 'unexpected success'; }
      catch (error) { return error.message; }
    }, wire(folder));
    assert.match(collision, /exist/i);
    await expect(page.getByRole('row', { name: 'retained.sml', exact: true })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('renamed λ.sml');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect.poll(() => fs.existsSync(path.join(folder, 'renamed λ.sml'))).toBe(true);
    await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await page.getByRole('dialog', { name: 'File operation' }).getByRole('button', { name: 'Move to trash', exact: true }).click();
    await expect.poll(() => fs.existsSync(path.join(folder, 'renamed λ.sml'))).toBe(false);
    const trash = path.join(folder, '.rune-ide/trash');
    const retained = fs.readdirSync(trash).map(id => path.join(trash, id, 'contents/renamed λ.sml')).find(file => fs.existsSync(file));
    assert.ok(retained); assert.match(fs.readFileSync(retained, 'utf8'), /val retained/);
    // Dirty journal restoration after forced application termination.
    await expect.poll(() => fs.readdirSync(path.join(env.RUNE_IDE_USER_DATA, 'ide-state')).filter(name => name.startsWith('buffer-')).length).toBeGreaterThan(0);
    const pid = app.process().pid;
    execFileSync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    await app.close().catch(() => {}); app = undefined;
    await launch(); await expect(page.getByRole('region', { name: 'Recover unsaved edits' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByText('1 unsaved · Rune')).toBeVisible();
    assert.equal(fs.readFileSync(file, 'utf8'), 'val outside = 9\r\n');
    await page.keyboard.press('Control+Shift+P');
    await page.getByRole('textbox', { name: 'Search commands' }).fill('theme light');
    await expect(page.getByRole('listbox', { name: 'Commands' }).getByRole('option')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Search commands' }).press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.screenshot({ path: path.join(results, 'native-windows.png') });
    assert.deepEqual(errors, []);
    const report = { platform: process.platform, release: os.release(), architecture: process.arch, elapsedMs: Date.now() - started, checks: ['hidden native Electron', 'bundled VM/compiler/Basis', 'Unicode paths/content', 'BOM/CRLF save', 'successful build and execution', 'diagnostic navigation and rebuild', 'native watching and reload', 'conflict copy', 'case-insensitive collision, rename and trash', 'forced termination and recovery', 'keyboard palette and light theme'] };
    fs.writeFileSync(path.join(results, 'acceptance.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } catch (error) {
    if (page && !page.isClosed()) { console.error(await page.locator('body').innerText().catch(() => '')); await page.screenshot({ path: path.join(results, 'failure.png'), timeout: 5000 }).catch(() => {}); }
    throw error;
  } finally {
    if (app) { await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }).catch(() => {}); await app.close().catch(() => {}); }
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });
