import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
test('packaged workbench connects to SML and opens a real workspace', async () => {
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT;
  env.RUNE_IDE_USER_DATA = test.info().outputPath('profile');
  const app = await electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env });
  try {
    const page = await app.firstWindow();
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())).toBe(false);
    const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
    await expect(page.getByText('SML service connected')).toBeVisible();
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/home/ruud/rune-ide'] }); });
    await page.getByRole('button', { name: /Open folder/ }).first().click();
    await expect(page.getByRole('treegrid', { name: 'Source files' })).toBeVisible();
    await expect(page.getByText('sources.txt', { exact: true })).toBeVisible();
    await page.getByText('src', { exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByText('renderer', { exact: true })).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
    await expect(page.locator('.monaco-editor')).toBeVisible();
    await page.screenshot({ path: 'test-results/workbench.png' });
    expect(errors).toEqual([]);
    const servicePid = Number(execFileSync('pgrep', ['-P', String(app.process().pid), '-x', 'runevm'], { encoding: 'utf8' }).trim());
    process.kill(servicePid, 'SIGKILL');
    await expect(page.locator('.error-banner')).toContainText('SML service exited');
  } finally { await app.close(); }
});

test('edit, save, split, undo, conflict and cancel a dirty close', async () => {
  const fs = await import('node:fs'); const os = await import('node:os');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-ui λ '));
  const file = path.join(folder, 'hello λ.sml');
  fs.writeFileSync(file, '\ufeffval x = 1\r\n'); fs.mkdirSync(path.join(folder, 'nested'));
  fs.writeFileSync(path.join(folder, 'nested', 'hello λ.sml'), 'val other = 2\n');
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT;
  env.RUNE_IDE_USER_DATA = test.info().outputPath('profile');
  const app = await electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env });
  try {
    const page = await app.firstWindow();
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByText('SML service connected')).toBeVisible();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await page.getByText('hello λ.sml', { exact: true }).click(); await page.keyboard.press('Enter');
    const editor = page.getByRole('textbox', { name: 'Source editor ' + file, exact: true });
    await expect(page.locator('[data-document] .monaco-editor')).toBeVisible(); await editor.focus(); await page.keyboard.press('Control+End');
    await page.keyboard.insertText('(* 🙂 edited *)');
    await expect(page.getByText('1 unsaved · Rune')).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('\ufeffval x = 1\r\n(* 🙂 edited *)');
    await page.getByRole('row', { name: 'nested', exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('row', { name: 'hello λ.sml', exact: true }).and(page.locator('[aria-level="2"]')).dblclick();
    await expect(page.getByRole('tab', { name: 'nested/hello λ.sml', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'hello λ.sml', exact: true }).click();
    await page.getByRole('button', { name: 'Split editor', exact: true }).click();
    await expect(editor).toHaveCount(2);
    await editor.last().focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('!');
    await page.keyboard.press('Control+z');
    await expect(page.getByText('0 unsaved · Rune')).toBeVisible();
    await page.getByRole('button', { name: /Close hello λ.sml/ }).last().click();
    await expect(editor).toHaveCount(1);
    await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('changed');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }); });
    await page.getByRole('button', { name: /Close hello λ.sml/ }).click();
    await expect(editor).toBeAttached();
    fs.writeFileSync(file, 'val external = 99\n');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.locator('.output .error')).toContainText('changed on disk');
    await page.getByRole('button', { name: 'Save and Build', exact: true }).click();
    await expect(page.locator('.output .error')).toContainText('changed on disk');
    expect((await page.evaluate(() => window.rune.buildStatus())).id).toBeNull();
    expect(fs.readFileSync(file, 'utf8')).toBe('val external = 99\n');
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await page.getByRole('button', { name: /Close hello λ.sml/ }).click();
    await expect(editor).toHaveCount(0);
    await page.getByRole('row', { name: 'hello λ.sml', exact: true }).last().dblclick();
    await expect(editor).toHaveCount(1);
    const doc = await page.evaluate(async (file) => window.rune.request<{ text: string }>('document/open', { path: file }), file);
    expect(doc.text).toBe('val external = 99\n');
    await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('(* closing *)');
    await app.evaluate(({ dialog, BrowserWindow }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }); BrowserWindow.getAllWindows()[0].close(); });
    await expect(page.getByText('1 unsaved · Rune')).toBeVisible();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await page.screenshot({ path: 'test-results/editor.png' });
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close(); fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('build, navigate a Rune diagnostic, fix the source and rebuild', async () => {
  const fs = await import('node:fs'); const os = await import('node:os');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-ui-build-'));
  const file = path.join(folder, 'a.sml');
  fs.writeFileSync(file, 'structure A = struct (* 🙂 λ *) val x : int = "bad" end\n');
  fs.writeFileSync(path.join(folder, 'b.sml'), 'structure B = struct val n = A.x end\n');
  fs.writeFileSync(path.join(folder, 'sources.txt'), 'a.sml\nb.sml\n');
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT;
  env.RUNE_IDE_USER_DATA = test.info().outputPath('profile');
  const app = await electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env });
  try {
    const page = await app.firstWindow(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await expect(page.getByText('SML service connected')).toBeVisible();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await expect(page.getByRole('combobox', { name: 'Build target' })).toHaveValue('workspace');
    await page.getByRole('button', { name: 'Save and Build', exact: true }).click();
    await expect(page.locator('.build-state')).toHaveText('Build failed');
    await expect(page.locator('.problem-row')).toContainText('type mismatch');
    await page.locator('.problem-row').click();
    await expect(page.getByRole('tab', { name: 'a.sml', exact: true })).toBeVisible();
    await expect(page.locator('.squiggly-error').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/compiler-diagnostic.png' });
    const editor = page.getByRole('textbox', { name: 'Source editor ' + file, exact: true });
    await editor.focus(); await page.keyboard.press('Control+a');
    await page.keyboard.insertText('structure A = struct val x = 42 end\n');
    await expect(page.locator('.squiggly-error')).toHaveCount(0);
    await page.getByRole('button', { name: 'Save and Build', exact: true }).click();
    await expect(page.locator('.build-state')).toHaveText('Build success');
    expect(fs.existsSync(path.join(folder, '.rune-ide/workspace.rbc'))).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('structure A = struct val x = 42 end\n');
    await expect(page.locator('.problem-row')).toHaveCount(0);
    await page.getByRole('tab', { name: 'Output', exact: true }).click();
    await expect(page.locator('.output')).toContainText('Build success');
    await page.screenshot({ path: 'test-results/compiled.png' });
    expect(errors).toEqual([]);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close(); fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('recover unsaved edits and split layout after forced termination', async () => {
  test.setTimeout(60000);
  const fs = await import('node:fs'); const os = await import('node:os');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-ui-recovery-'));
  const file = path.join(folder, 'draft.sml'); fs.writeFileSync(file, 'val n = 1\n');
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT; env.RUNE_IDE_USER_DATA = test.info().outputPath('profile');
  const launch = () => electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.getByText('SML service connected')).toBeVisible();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await page.getByRole('row', { name: 'draft.sml', exact: true }).dblclick();
    await page.getByRole('button', { name: 'Split editor', exact: true }).click();
    await page.getByText('Show excluded files', { exact: true }).click();
    await expect(page.getByRole('checkbox', { name: 'Show excluded files' })).toBeChecked();
    const editor = page.getByRole('textbox', { name: 'Source editor ' + file, exact: true });
    await editor.last().focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('(* recover 🙂 *)');
    await expect.poll(async () => (await page.evaluate(file => window.rune.request<{ text: string }>('document/open', { path: file }), file)).text).toContain('recover 🙂');
    await expect.poll(async () => {
      const session = await page.evaluate(() => window.rune.request<{ settings: { showExcluded?: boolean }; view: { layout: { panels: Record<string, { params?: { path?: string } }> } } }>('session/load'));
      return session.settings.showExcluded ? Object.values(session.view?.layout?.panels || {}).filter(p => p.params?.path === file).length : 0;
    }).toBe(2);
    const stopped = new Promise(resolve => app.process().once('exit', resolve)); app.process().kill('SIGKILL'); await stopped;
    expect(fs.readFileSync(file, 'utf8')).toBe('val n = 1\n');
    app = await launch(); page = await app.firstWindow();
    await expect(page.getByRole('region', { name: 'Recover unsaved edits' })).toBeVisible();
    await page.getByRole('button', { name: 'Restore', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Recover unsaved edits' })).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Source editor ' + file, exact: true })).toHaveCount(2);
    await expect(page.getByRole('checkbox', { name: 'Show excluded files' })).toBeChecked();
    const recovered = await page.evaluate(file => window.rune.request<{ text: string; dirty: boolean }>('document/open', { path: file }), file);
    expect(recovered.text).toBe('val n = 1\n(* recover 🙂 *)'); expect(recovered.dirty).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('val n = 1\n');
    await page.screenshot({ path: 'test-results/recovered.png' });
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await app.close();
    app = await launch(); page = await app.firstWindow();
    await expect(page.getByRole('textbox', { name: 'Source editor ' + file, exact: true })).toHaveCount(2);
    await expect(page.getByRole('region', { name: 'Recover unsaved edits' })).toHaveCount(0);
    expect((await page.evaluate(file => window.rune.request<{ text: string }>('document/open', { path: file }), file)).text).toBe('val n = 1\n');
  } finally {
    if (app.process().exitCode === null && app.process().signalCode === null) {
      await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }); await app.close();
    }
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('restart a crashed SML service without losing the live editor or undo', async () => {
  const fs = await import('node:fs'); const os = await import('node:os');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-ui-restart-'));
  const file = path.join(folder, 'live.sml'); fs.writeFileSync(file, 'val n = 1\n');
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT; env.RUNE_IDE_USER_DATA = test.info().outputPath('profile');
  const app = await electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('SML service connected')).toBeVisible();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await page.getByRole('row', { name: 'live.sml', exact: true }).dblclick();
    const editor = page.getByRole('textbox', { name: 'Source editor ' + file, exact: true });
    await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('val live = 2');
    const pid = Number(execFileSync('pgrep', ['-P', String(app.process().pid), '-x', 'runevm'], { encoding: 'utf8' }).trim()); process.kill(pid, 'SIGKILL');
    await expect(page.getByRole('button', { name: 'Restart service' })).toBeVisible();
    await page.getByRole('button', { name: 'Restart service' }).click();
    await expect(page.locator('.error-banner')).toHaveCount(0);
    expect((await page.evaluate(file => window.rune.request<{ text: string }>('document/open', { path: file }), file)).text).toBe('val n = 1\nval live = 2');
    await editor.focus();
    // Native EditContext can split insertText into several word-sized undo steps.
    for (let n = 0; n < 10 && !await page.getByText('0 unsaved · Rune').isVisible(); n++) await page.keyboard.press('Control+z');
    await expect(page.getByText('0 unsaved · Rune')).toBeVisible();
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('(* after restart *)');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe('val n = 1\n(* after restart *)');
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }); await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('watch external changes, retain conflicts, rename with undo, and move files to trash', async () => {
  const fs = await import('node:fs'); const os = await import('node:os');
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-ui-files-'));
  const file = path.join(folder, 'main.sml'); fs.writeFileSync(file, 'val n = 1\n');
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.RUNE_IDE_USER_DATA = test.info().outputPath('profile');
  delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT;
  const app = await electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env });
  try {
    const page = await app.firstWindow();
    await expect(page.getByText('SML service connected')).toBeVisible();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await page.getByRole('row', { name: 'main.sml', exact: true }).dblclick();
    const editor = page.getByRole('textbox', { name: 'Source editor ' + file, exact: true });
    fs.writeFileSync(path.join(folder, 'external.sml'), 'val external = 1\n');
    await expect(page.getByRole('row', { name: 'external.sml', exact: true })).toBeVisible();
    fs.writeFileSync(file, 'val n = 2\n');
    await expect.poll(async () => (await page.evaluate(file => window.rune.request<{ text: string }>('document/open', { path: file }), file)).text).toBe('val n = 2\n');
    await editor.focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('val local = 3');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('val local = 3');
    await page.getByRole('row', { name: 'main.sml', exact: true }).click();
    await page.getByRole('button', { name: 'Rename', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('renamed.sml');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    const renamed = path.join(folder, 'renamed.sml');
    await expect(page.getByRole('tab', { name: 'renamed.sml', exact: true })).toBeVisible();
    expect(fs.existsSync(file)).toBe(false);
    const movedEditor = page.getByRole('textbox', { name: 'Source editor ' + renamed, exact: true });
    await movedEditor.focus(); await page.keyboard.press('Control+z');
    await expect(page.getByText('1 unsaved · Rune')).toBeVisible();
    fs.writeFileSync(renamed, 'val disk = 9\n');
    await expect(page.locator('.disk-banner')).toContainText('changed on disk');
    await page.getByRole('button', { name: 'Save a copy', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('rescued.sml');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'rescued.sml', exact: true })).toBeVisible();
    expect(fs.readFileSync(path.join(folder, 'rescued.sml'), 'utf8')).not.toBe('val disk = 9\n');
    await page.getByRole('tab', { name: /renamed.sml/ }).click();
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await page.getByRole('button', { name: 'Reload from disk' }).click();
    await expect(page.locator('.disk-banner')).toHaveCount(0);
    expect((await page.evaluate(file => window.rune.request<{ text: string }>('document/open', { path: file }), renamed)).text).toBe('val disk = 9\n');
    await page.getByRole('row', { name: 'renamed.sml', exact: true }).click();
    await page.getByRole('button', { name: 'Move to trash', exact: true }).click();
    await page.getByRole('dialog', { name: 'File operation' }).getByRole('button', { name: 'Move to trash', exact: true }).click();
    await expect(page.getByRole('tab', { name: /renamed.sml/ })).toHaveCount(0);
    expect(fs.existsSync(renamed)).toBe(false);
    const trash = fs.readdirSync(path.join(folder, '.rune-ide/trash'))[0];
    expect(fs.readFileSync(path.join(folder, '.rune-ide/trash', trash, 'contents/renamed.sml'), 'utf8')).toBe('val disk = 9\n');
    await page.getByRole('button', { name: 'New file', exact: true }).click();
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill('created.sml');
    await page.getByRole('button', { name: 'Apply', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'created.sml', exact: true })).toBeVisible();
    expect(fs.readFileSync(path.join(folder, 'created.sml'), 'utf8')).toBe('');
    await page.screenshot({ path: 'test-results/file-operations.png' });
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }); await app.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
});

test('relocated package builds with its bundled toolchain and an empty executable search path', async () => {
  test.setTimeout(90000);
  const fs = await import('node:fs'); const os = await import('node:os');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-portable-'));
  const workspace = path.join(temp, 'sources'); fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, 'main.sml'), 'val _ = print "Portable Rune\\n"\n');
  fs.writeFileSync(path.join(workspace, 'sources.txt'), 'main.sml\n');
  const first = path.join(temp, 'first location'), second = path.join(temp, 'moved location');
  fs.cpSync(path.resolve('out/Rune-linux-x64'), first, { recursive: true, mode: fs.constants.COPYFILE_FICLONE });
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT;
  env.PATH = '/no-executables-here'; env.RUNE_IDE_USER_DATA = path.join(temp, 'profile');
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  try {
    app = await electron.launch({ executablePath: path.join(first, 'rune-ide'), cwd: temp, env });
    let page = await app.firstWindow(); await expect(page.getByText('SML service connected')).toBeVisible();
    await app.evaluate(({ dialog }, workspace) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [workspace] }); }, workspace);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await expect(page.getByRole('combobox', { name: 'Build target' })).toHaveValue('workspace');
    await page.getByRole('button', { name: 'Save and Build', exact: true }).click();
    await expect(page.locator('.build-state')).toHaveText('Build success');
    expect(await page.evaluate(() => window.rune.toolchain())).toBe(path.join(first, 'resources/toolchain'));
    await app.close(); app = undefined;
    fs.renameSync(first, second);
    app = await electron.launch({ executablePath: path.join(second, 'rune-ide'), cwd: temp, env });
    page = await app.firstWindow(); await expect(page.getByText('SML service connected')).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Build target' })).toHaveValue('workspace');
    expect(await page.evaluate(() => window.rune.toolchain())).toBe(path.join(second, 'resources/toolchain'));
    await page.getByRole('button', { name: 'Save and Build', exact: true }).click();
    await expect(page.locator('.build-state')).toHaveText('Build success');
    const output = execFileSync(path.join(second, 'resources/toolchain/bin/runevm'), [path.join(workspace, '.rune-ide/workspace.rbc')], { encoding: 'utf8', cwd: temp, env });
    expect(output).toBe('Portable Rune\n');
    expect((await page.evaluate(() => window.rune.request<{ settings: { toolchain: string | null } }>('session/load'))).settings.toolchain).toBeNull();
  } finally { if (app) await app.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
