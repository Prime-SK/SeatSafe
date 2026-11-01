import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import type { EntityManager } from 'typeorm';
import { UserEntity } from '../users/user.entity.js';
import { AuthSessionEntity } from '../auth/auth-session.entity.js';
import type { AuthenticatedPrincipal } from '../auth/authenticated-request.js';
import { unauthorized } from '../auth/session-authentication.service.js';
import { RegistrationError } from '../auth/registration-error.js';
import { adminUserResponse } from './admin-users.dto.js';
import type {
  AdminUserDto,
  AdminUserPageDto,
  UserListQuery,
} from './admin-users.dto.js';

const unavailable = () =>
  new RegistrationError(503, 'DATABASE_UNAVAILABLE', 'Database unavailable');
@Injectable()
export class AdminUsersService {
  constructor(@InjectDataSource() private readonly database: DataSource) {}
  private async databaseOperation<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw unavailable();
    }
  }
  private async transaction<T>(
    work: (manager: EntityManager) => Promise<T>,
    readOnly = false,
  ): Promise<T> {
    try {
      const run = async (manager: EntityManager) => {
        try {
          if (readOnly)
            await this.databaseOperation(() =>
              manager.query('SET TRANSACTION READ ONLY'),
            );
          return await work(manager);
        } catch (error) {
          if (error instanceof RegistrationError) throw error;
          throw new RegistrationError(
            500,
            'INTERNAL_ERROR',
            readOnly ? 'Unable to list users' : 'Unable to update user status',
          );
        }
      };
      return readOnly
        ? await this.database.transaction('REPEATABLE READ', run)
        : await this.database.transaction(run);
    } catch (error) {
      if (error instanceof RegistrationError) throw error;
      throw unavailable();
    }
  }
  list(input: UserListQuery): Promise<AdminUserPageDto> {
    return this.transaction(async (manager) => {
      const query = manager
        .getRepository(UserEntity)
        .createQueryBuilder('user')
        .select([
          'user.id',
          'user.displayName',
          'user.email',
          'user.role',
          'user.isEnabled',
        ]);
      if (input.search) {
        // ! is the SQL escape character; user %, _ and ! are literal search text.
        const search = `%${input.search.replace(/[!%_]/g, (character) => '!' + character)}%`;
        query.andWhere(
          "(user.displayName ILIKE :search ESCAPE '!' OR user.email ILIKE :search ESCAPE '!')",
          { search },
        );
      }
      if (input.status)
        query.andWhere('user.isEnabled = :enabled', {
          enabled: input.status === 'enabled',
        });
      const total = await this.databaseOperation(() => query.getCount());
      const users = await this.databaseOperation(() =>
        query
          .orderBy('user.createdAt', 'DESC')
          .addOrderBy('user.id', 'DESC')
          .skip((input.page - 1) * input.limit)
          .take(input.limit)
          .getMany(),
      );
      return {
        items: users.map(adminUserResponse),
        total,
        page: input.page,
        limit: input.limit,
      };
    }, true);
  }
  update(
    principal: AuthenticatedPrincipal,
    id: string,
    isEnabled: boolean,
  ): Promise<AdminUserDto> {
    return this.transaction(async (manager) => {
      const users = manager.getRepository(UserEntity);
      const actor = await this.databaseOperation(() =>
        users.findOne({
          where: { id: principal.id },
          lock: { mode: 'pessimistic_write' },
        }),
      );
      if (!actor?.isEnabled) throw unauthorized();
      if (actor.role !== 'ADMIN')
        throw new RegistrationError(
          403,
          'FORBIDDEN',
          'Insufficient permissions',
        );
      await this.requireSession(manager, principal);
      // ADMIN targets need no mutation lock. Refuse them early so two administrators
      // targeting one another cannot deadlock while each holds their own user lock.
      const candidate =
        id === actor.id
          ? actor
          : await this.databaseOperation(() => users.findOneBy({ id }));
      if (candidate?.role === 'ADMIN')
        throw new RegistrationError(
          409,
          'ADMIN_ACCOUNT_PROTECTED',
          'Administrator accounts cannot be changed',
        );
      const target =
        id === actor.id
          ? actor
          : await this.databaseOperation(() =>
              users.findOne({
                where: { id },
                lock: { mode: 'pessimistic_write' },
              }),
            );
      await this.requireSession(manager, principal);
      if (!target)
        throw new RegistrationError(404, 'USER_NOT_FOUND', 'User not found');
      if (target.role === 'ADMIN')
        throw new RegistrationError(
          409,
          'ADMIN_ACCOUNT_PROTECTED',
          'Administrator accounts cannot be changed',
        );
      if (target.isEnabled !== isEnabled)
        await this.databaseOperation(() => users.update(id, { isEnabled }));
      if (!isEnabled)
        await this.databaseOperation(() =>
          manager
            .getRepository(AuthSessionEntity)
            .update(
              { userId: id, revokedAt: IsNull() },
              { revokedAt: new Date() },
            ),
        );
      target.isEnabled = isEnabled;
      return adminUserResponse(target);
    });
  }
  private async requireSession(
    manager: EntityManager,
    principal: AuthenticatedPrincipal,
  ): Promise<void> {
    const session = await this.databaseOperation(() =>
      manager
        .getRepository(AuthSessionEntity)
        .findOneBy({ id: principal.sessionId, userId: principal.id }),
    );
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= Date.now()
    )
      throw unauthorized();
  }
}
