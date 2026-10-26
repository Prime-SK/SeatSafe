import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { Authentication } from './authentication';
export const authGuard: CanActivateFn = () => {
  const auth = inject(Authentication),
    router = inject(Router);
  return auth.ensureSession().pipe(
    map(() => true),
    catchError(() => of(router.createUrlTree(['/login']))),
  );
};
