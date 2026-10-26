import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { providePrimeNG } from 'primeng/config';
import { authInterceptor } from './auth/auth-interceptor';
import { seatSafeTheme } from './prime-theme';

export function createAppConfig(license = ''): ApplicationConfig {
  return {
    providers: [
      provideBrowserGlobalErrorListeners(),
      provideHttpClient(withInterceptors([authInterceptor])),
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
