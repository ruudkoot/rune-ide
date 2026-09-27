import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function environment(profile: string) {
  const env: Record<string, string> = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  delete env.ELECTRON_RUN_AS_NODE; delete env.RUNE_ROOT;
  env.RUNE_IDE_USER_DATA = profile;
  return env;
}
test('command palette, keyboard panel navigation and themes survive restart', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-commands-'));
  const file = path.join(folder, 'main.sml'); fs.writeFileSync(file, 'val x = 1\n');
  const env = environment(test.info().outputPath('profile'));
  const launch = () => electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    await expect(page.getByText('SML service connected')).toBeVisible();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await page.getByRole('row', { name: 'main.sml', exact: true }).dblclick();
    await page.keyboard.press('Control+Shift+P');
    const search = page.getByRole('textbox', { name: 'Search commands' });
    await expect(search).toBeFocused(); await search.fill('theme light');
    await expect(page.getByRole('listbox', { name: 'Commands', exact: true }).getByRole('option')).toHaveCount(1); await search.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.keyboard.press('Control+Shift+E');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('[aria-label="Source files"]'))).toBe(true);
    await page.keyboard.press('Control+1');
    await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest('.monaco-editor'))).toBe(true);
    await page.keyboard.press('Control+Shift+P'); await expect(search).toBeFocused(); await search.fill('focus output');
    await expect(page.getByRole('listbox', { name: 'Commands', exact: true }).getByRole('option')).toHaveCount(1); await search.press('ArrowDown'); await page.keyboard.press('Enter');
    await expect(page.getByLabel('Build output', { exact: true })).toBeFocused();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.5));
    await expect(page.getByRole('button', { name: 'Commands', exact: true })).toBeVisible();
    const right = await page.getByRole('button', { name: 'Open folder', exact: true }).first().boundingBox();
    expect(right!.x + right!.width).toBeLessThanOrEqual(await page.evaluate(() => window.innerWidth));
    await page.getByRole('button', { name: 'Commands', exact: true }).click(); await search.fill('theme high');
    await expect(page.getByRole('listbox', { name: 'Commands', exact: true }).getByRole('option')).toHaveCount(1); await search.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
    await page.screenshot({ path: 'test-results/contrast-scaled.png' });
    await expect.poll(() => JSON.parse(fs.readFileSync(path.join(env.RUNE_IDE_USER_DATA, 'ide-state/session.json'), 'utf8')).settings.theme).toBe('contrast');
    await app.close();
    const sessionFile = path.join(env.RUNE_IDE_USER_DATA, 'ide-state/session.json');
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf8'));
    const layout = session.view.layout;
    const groups: Record<string, any> = {};
    const remove = (node: any) => {
      if (Array.isArray(node.data)) node.data = node.data.filter((child: any) => remove(child));
      else if (node.data.views.some((id: string) => id.startsWith('document:') || id === 'output')) {
        groups[node.data.views.includes('output') ? 'output' : 'editor'] = node.data;
        return false;
      }
      return true;
    };
    remove(layout.grid.root);
    layout.floatingGroups = [{ data: groups.editor, position: { left: 280, top: 40, width: 500, height: 350 } }];
    layout.edgeGroups = { bottom: { size: 160, visible: true, group: groups.output } };
    fs.writeFileSync(sessionFile, JSON.stringify(session));
    app = await launch(); page = await app.firstWindow();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'contrast');
    await expect(page.getByRole('tab', { name: 'main.sml', exact: true })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Output', exact: true })).toBeVisible();
    await expect(page.locator('.error')).toHaveCount(0);
  } finally { await app.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});

test('measure 5000 files and 64 tabs with editor disposal', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rune-perf-'));
  for (let n = 0; n < 5000; n++) fs.writeFileSync(path.join(folder, `file-${String(n).padStart(4, '0')}.sml`), `val value${n} = ${n}\n`);
  const app = await electron.launch({ executablePath: path.resolve('out/Rune-linux-x64/rune-ide'), env: environment(test.info().outputPath('profile')) });
  try {
    const page = await app.firstWindow(); await expect(page.getByText('SML service connected')).toBeVisible();
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); const { metrics } = await cdp.send('Performance.getMetrics'); return metrics.find(row => row.name === 'JSHeapUsedSize')!.value; };
    const baseline = await heap();
    await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
    const treeStart = Date.now(); await page.getByRole('button', { name: 'Open folder', exact: true }).first().click();
    await expect(page.getByRole('row', { name: 'file-0000.sml', exact: true })).toBeVisible({ timeout: 15_000 });
    const treeMs = Date.now() - treeStart;
    expect(await page.getByRole('treegrid').getByRole('row').count()).toBeLessThan(200);
    await page.getByRole('row', { name: 'file-0000.sml', exact: true }).click();
    await page.keyboard.press('End'); await expect(page.getByRole('row', { name: 'file-4999.sml', exact: true })).toBeVisible();
    await page.keyboard.press('Home'); await expect(page.getByRole('row', { name: 'file-0000.sml', exact: true })).toBeVisible();
    const listingMs = await page.evaluate(async folder => { const t = performance.now(); const rows = await window.rune.request<unknown[]>('workspace/list', { path: folder }); if (rows.length !== 5000) throw Error('incomplete listing'); return performance.now() - t; }, folder);
    const tabsStart = Date.now();
    for (let n = 0; n < 64; n++) {
      const name = `file-${String(n).padStart(4, '0')}.sml`;
      await page.getByRole('treegrid').evaluate((element, n) => { element.scrollTop = Math.max(0, n * 28 - 100); }, n);
      await page.getByRole('row', { name, exact: true }).click({ timeout: 5000 }); await page.keyboard.press('Enter');
      await expect(page.getByRole('tab', { name, exact: true })).toBeAttached();
      await expect(page.locator('[data-document] .monaco-editor')).toBeVisible();
    }
    const tabsMs = Date.now() - tabsStart; const peak = await heap();
    expect(await page.evaluate(() => window.rune.request<unknown[]>('document/list').then(rows => rows.length))).toBe(64);
    expect(await page.locator('[data-document] .monaco-editor').count()).toBeLessThanOrEqual(2);
    const closeStart = Date.now();
    await page.getByRole('button', { name: 'Commands', exact: true }).click();
    const search = page.getByRole('textbox', { name: 'Search commands' }); await search.fill('close all');
    await expect(page.getByRole('listbox', { name: 'Commands', exact: true }).getByRole('option')).toHaveCount(1); await page.getByRole('listbox', { name: 'Commands', exact: true }).getByRole('option').click();
    await expect.poll(() => page.evaluate(() => window.rune.request<unknown[]>('document/list').then(rows => rows.length)), { timeout: 30_000 }).toBe(0);
    await expect(page.locator('[data-document] .monaco-editor')).toHaveCount(0);
    const closeMs = Date.now() - closeStart; const closed = await heap();
    const report = { fixture: '5000 sibling SML files, 64 open tabs', hardware: os.cpus()[0]?.model, platform: os.platform(), totalMemory: os.totalmem(), treeMs, listingMs, tabsMs, closeMs, baselineHeap: baseline, peakHeap: peak, closedHeap: closed };
    fs.writeFileSync('test-results/performance.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
    expect(treeMs).toBeLessThan(15_000); expect(listingMs).toBeLessThan(5000); expect(tabsMs).toBeLessThan(120_000);
    expect(peak - baseline).toBeLessThan(512 * 1024 * 1024); expect(closed).toBeLessThan(peak + 8 * 1024 * 1024);
  } finally { await app.close(); fs.rmSync(folder, { recursive: true, force: true }); }
});
