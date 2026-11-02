import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';
process.env.AUTH_ALLOWED_ORIGINS = 'http://127.0.0.1:3199';
export default defineConfig({
  ...base,
  webServer: undefined,
  projects: [
    {
      name: 'release',
      testMatch: '**/release.pw.ts',
      use: {
        baseURL: 'http://127.0.0.1:3199',
        viewport: { width: 1280, height: 900 },
      },
    },
  ],
});
