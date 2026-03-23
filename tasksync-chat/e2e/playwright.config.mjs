import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.TASKSYNC_E2E_BASE_URL || 'http://127.0.0.1:3580';

export default defineConfig({
    testDir: './tests',
    timeout: 60000,
    expect: { timeout: 10000 },
    fullyParallel: false,
    retries: process.env.CI ? 2 : 0,
    reporter: [
        ['list'],
        ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
});
