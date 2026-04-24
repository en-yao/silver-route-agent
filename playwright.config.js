import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 120000,
  expect: {
    timeout: 20000
  },
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure'
  },
  webServer: [
    {
      command: 'npm.cmd run dev:server',
      url: 'http://localhost:8787/api/health',
      reuseExistingServer: true,
      timeout: 120000
    },
    {
      command: 'npm.cmd run dev:client',
      url: 'http://localhost:5174',
      reuseExistingServer: true,
      timeout: 120000
    }
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ]
});
