import { defineConfig } from '@playwright/test';
import { config } from 'dotenv';

// Public fixtures replace application secrets in this test process only.
config({ path: '.env', quiet: true });
if (
  process.env.NODE_ENV &&
  !['development', 'test'].includes(process.env.NODE_ENV)
)
  throw new Error('Browser verification refuses production mode');
process.env.NODE_ENV = 'development';
process.env.JWT_SECRET = 'public-browser-test-signing-secret-32-bytes';
process.env.AUTH_ALLOWED_ORIGINS = 'http://127.0.0.1:4201';
process.env.RELIABILITY_LAB_ENABLED = 'false';

export default defineConfig({
  testDir: './browser',
  testMatch: '**/*.pw.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:4201',
    browserName: 'chromium',
    timezoneId: 'Asia/Colombo',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: '**/mobile.pw.ts',
      use: { viewport: { width: 1280, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: '**/mobile.pw.ts',
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
        reducedMotion: 'reduce',
      },
    },
  ],
  webServer: {
    env: { PORT: '4201' },
    command:
      'npm --prefix ../web start -- --host 127.0.0.1 --port 4201 --proxy-config src/proxy.e2e.conf.json',
    url: 'http://127.0.0.1:4201',
    reuseExistingServer: false,
    timeout: 120000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
