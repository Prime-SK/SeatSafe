import { inject } from '@angular/core';
import { HttpContextToken, HttpInterceptorFn } from '@angular/common/http';
import { Authentication } from './authentication';
export const REQUIRES_AUTH = new HttpContextToken<boolean>(() => false);
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (
    !request.context.get(REQUIRES_AUTH) ||
    !request.url.startsWith('/api/') ||
    request.url.startsWith('/api/auth/login') ||
    request.url.startsWith('/api/auth/refresh') ||
    request.url.startsWith('/api/auth/logout') ||
    request.url.startsWith('/api/auth/register')
  )
    return next(request);
  return inject(Authentication).send(request, next);
};
