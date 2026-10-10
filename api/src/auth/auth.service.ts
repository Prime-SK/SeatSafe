import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { UserEntity } from '../users/user.entity.js';
import { PasswordHasher } from './password-hasher.js';
import { RegistrationError } from './registration-error.js';
import type { RegisterDto } from './register.dto.js';

export interface RegisteredUser {
  id: string;
  displayName: string;
  email: string;
  role: 'USER';
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly users: Repository<UserEntity>,
    private readonly passwords: PasswordHasher,
  ) {}
  async register(input: RegisterDto): Promise<RegisteredUser> {
    let passwordHash: string;
    try {
      passwordHash = await this.passwords.hash(input.password);
    } catch {
      throw new RegistrationError(
        500,
        'INTERNAL_ERROR',
        'Unable to create account',
      );
    }

    const user: RegisteredUser = {
      id: randomUUID(),
      displayName: input.displayName,
      email: input.email,
      role: 'USER',
    };
    try {
      await this.users.insert({ ...user, passwordHash, isEnabled: true });
    } catch (error) {
      if (error instanceof QueryFailedError) {
        const driver = error.driverError as {
          code?: string;
          constraint?: string;
        };
        if (driver.code === '23505' && driver.constraint === 'UQ_users_email') {
          throw new RegistrationError(
            409,
            'EMAIL_ALREADY_EXISTS',
            'An account with this email already exists',
          );
        }
      }
      throw new RegistrationError(
        503,
        'DATABASE_UNAVAILABLE',
        'Database unavailable',
      );
    }
    return user;
  }
}
