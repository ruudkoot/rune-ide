import { defineConfig } from '@playwright/test';
process.env.RUNE_IDE_TEST_BACKGROUND = '1';
export default defineConfig({ testDir: './tests/ui', timeout: 30_000, workers: 1, reporter: 'list', use: { screenshot: 'only-on-failure' } });
