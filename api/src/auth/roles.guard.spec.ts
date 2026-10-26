import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import type { ExecutionContext } from '@nestjs/common';
import { Roles, REQUIRED_ROLES } from './roles.decorator.js';
import { RolesGuard } from './roles.guard.js';
import type { AuthenticatedPrincipal } from './authenticated-request.js';

@Roles('ADMIN')
class Example {
  inherited() {}
  @Roles('USER', 'ADMIN') either() {}
  @Roles('USER') overridden() {}
  @Roles() empty() {}
}

describe('Role authorization metadata', () => {
  const guard = new RolesGuard(new Reflector());
  function context(
    method: keyof Example,
    role?: 'USER' | 'ADMIN',
  ): ExecutionContext {
    return {
      getClass: () => Example,
      getHandler: () => Example.prototype[method],
      switchToHttp: () => ({
        getRequest: () => ({
          user: role ? ({ role } as AuthenticatedPrincipal) : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }
  it('stores typed controller requirements', () => {
    expect(Reflect.getMetadata(REQUIRED_ROLES, Example)).toEqual(['ADMIN']);
  });
  it('inherits controller ADMIN permission', () => {
    expect(guard.canActivate(context('inherited', 'ADMIN'))).toBe(true);
    expect(() => guard.canActivate(context('inherited', 'USER'))).toThrow(
      'Insufficient permissions',
    );
  });
  it.each(['USER', 'ADMIN'] as const)(
    'permits either matching role: %s',
    (role) => {
      expect(guard.canActivate(context('either', role))).toBe(true);
    },
  );
  it('overrides rather than merges controller roles', () => {
    expect(guard.canActivate(context('overridden', 'USER'))).toBe(true);
    expect(() => guard.canActivate(context('overridden', 'ADMIN'))).toThrow(
      'Insufficient permissions',
    );
  });
  it('fails closed for an empty role declaration', () => {
    expect(() => guard.canActivate(context('empty', 'ADMIN'))).toThrow(
      'Insufficient permissions',
    );
  });
  it('requires a verified principal even without metadata', () => {
    const missing = context('inherited');
    expect(() => guard.canActivate(missing)).toThrow('Authentication required');
  });
  it('allows an authenticated route without a role requirement', () => {
    const unscoped = {
      ...context('inherited', 'USER'),
      getClass: () => class {},
      getHandler: () => () => undefined,
    } as ExecutionContext;
    expect(guard.canActivate(unscoped)).toBe(true);
  });
});
