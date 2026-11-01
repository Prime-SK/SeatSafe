import { Injectable } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { isUUID } from 'class-validator';
import { RegistrationError } from '../auth/registration-error.js';
import type { UserEntity } from '../users/user.entity.js';

export const invalidUserRequest = (field: string, message: string) =>
  new RegistrationError(
    400,
    'VALIDATION_FAILED',
    'Invalid user administration request',
    { [field]: [message] },
  );
export interface UserListQuery {
  page: number;
  limit: number;
  search?: string;
  status?: 'enabled' | 'disabled';
}
@Injectable()
export class UserListPipe implements PipeTransform {
  transform(value: Record<string, unknown>): UserListQuery {
    for (const key of Object.keys(value)) {
      if (!['page', 'limit', 'search', 'status'].includes(key))
        throw invalidUserRequest(key, 'Unknown query parameter');
      if (typeof value[key] !== 'string')
        throw invalidUserRequest(key, 'Supply one query value');
    }
    const integer = (key: string, fallback: number, max: number) => {
      if (value[key] === undefined) return fallback;
      const raw = value[key] as string;
      const number = Number(raw);
      if (
        !/^\d+$/.test(raw) ||
        !Number.isSafeInteger(number) ||
        number < 1 ||
        number > max
      )
        throw invalidUserRequest(key, `Supply an integer between 1 and ${max}`);
      return number;
    };
    const search = (value.search as string | undefined)?.trim();
    if (search && Array.from(search).length > 200)
      throw invalidUserRequest(
        'search',
        'Search must contain at most 200 characters',
      );
    const status = value.status;
    if (status !== undefined && status !== 'enabled' && status !== 'disabled')
      throw invalidUserRequest('status', 'Use enabled or disabled');
    return {
      page: integer('page', 1, 2147483647),
      limit: integer('limit', 25, 100),
      ...(search ? { search } : {}),
      ...(status ? { status } : {}),
    };
  }
}
@Injectable()
export class UserStatusPipe implements PipeTransform {
  transform(value: unknown): { isEnabled: boolean } {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).length !== 1 ||
      !('isEnabled' in value) ||
      typeof value.isEnabled !== 'boolean'
    )
      throw invalidUserRequest(
        'isEnabled',
        'Supply exactly one boolean isEnabled field',
      );
    return { isEnabled: value.isEnabled };
  }
}
@Injectable()
export class UserIdPipe implements PipeTransform {
  transform(value: string): string {
    if (!isUUID(value))
      throw invalidUserRequest('id', 'Supply a valid account UUID');
    return value;
  }
}
export class AdminUserDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty() displayName: string;
  @ApiProperty() email: string;
  @ApiProperty({ enum: ['USER', 'ADMIN'] }) role: UserEntity['role'];
  @ApiProperty() isEnabled: boolean;
}
export class AdminUserPageDto {
  @ApiProperty({ type: [AdminUserDto] }) items: AdminUserDto[];
  @ApiProperty() total: number;
  @ApiProperty() page: number;
  @ApiProperty() limit: number;
}
export class UserStatusDto {
  @ApiProperty({
    example: false,
    description:
      'USER accounts only. Enabling requires a fresh login; disabling revokes all sessions.',
  })
  isEnabled: boolean;
}
export function adminUserResponse(user: UserEntity): AdminUserDto {
  return {
    id: user.id,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    isEnabled: user.isEnabled,
  };
}
