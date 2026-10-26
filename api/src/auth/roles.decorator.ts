import { SetMetadata } from '@nestjs/common';
import type { UserEntity } from '../users/user.entity.js';

export type AccountRole = UserEntity['role'];
export const REQUIRED_ROLES = Symbol('seatsafe.requiredRoles');
export const Roles = (...roles: AccountRole[]) =>
  SetMetadata(REQUIRED_ROLES, roles);
