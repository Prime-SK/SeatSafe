import { bootstrapApplication } from '@angular/platform-browser';
import { createAppConfig } from './app/app.config';
import { App } from './app/app';

// Optional ignored local asset; the key is intentionally not committed.
async function start(): Promise<void> {
  let license = '';
  try {
    const response = await fetch('/primeui-license.local.json');
    if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
      const config: unknown = await response.json();
      if (
        config &&
        typeof config === 'object' &&
        'license' in config &&
        typeof config.license === 'string'
      )
        license = config.license;
    }
  } catch {
    /* A missing local key leaves PrimeNG's own licence notice visible. */
  }
  await bootstrapApplication(App, createAppConfig(license));
}
void start().catch((error: unknown) => console.error(error));
