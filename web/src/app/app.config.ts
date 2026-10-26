import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import { seatSafeTheme } from './prime-theme';

export function createAppConfig(license = ''): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideHttpClient(),
      provideRouter(routes),
      providePrimeNG({
        license,
        theme: {
          preset: seatSafeTheme,
          options: {
            darkModeSelector: false,
          },
        },
      }),
    ],
  };
}
