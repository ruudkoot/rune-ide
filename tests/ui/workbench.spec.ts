import { test, expect, _electron as electron } from '@playwright/test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
test('packaged workbench connects to SML and opens a real workspace', async () => {
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  env.RUNE_ROOT = process.env.RUNE_ROOT || '/home/ruud/rune';
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env });
  try {
    const page = await app.firstWindow();
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
