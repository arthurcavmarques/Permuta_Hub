import { defineConfig, devices } from '@playwright/test';

// Smoke/aceite contra produção. Uso:
//   ACEITE_EMAIL=... ACEITE_PASSWORD=... npx playwright test -c playwright.prod.config.ts
export default defineConfig({
  testDir: './e2e-prod',
  timeout: 60_000,
  use: {
    baseURL: process.env.PROD_URL ?? 'https://permutahub.permutahub.workers.dev',
    trace: 'retain-on-failure',
    locale: 'pt-BR',
  },
  projects: [{ name: 'celular', use: { ...devices['Pixel 7'] } }],
});
