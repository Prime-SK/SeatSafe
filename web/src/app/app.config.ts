import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import { seatSafeTheme } from './prime-theme';
import aura from '@primeuix/themes/aura';

export function createAppConfig(license = ''): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideHttpClient(),
      provideRouter(routes),
      providePrimeNG({
        license,
        theme: {
          preset: aura,
          options: {
            darkModeSelector: false,
          },
        },
      }),
    ],
  };
}
