import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  workers: 1,
  webServer: {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:4321/recorder.html',
    reuseExistingServer: !process.env.CI,
  },
})
