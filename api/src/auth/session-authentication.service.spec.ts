import { vi } from 'vitest';
import { Repository } from 'typeorm';
import { AuthSessionEntity } from './auth-session.entity.js';
import { SessionAuthenticationService } from './session-authentication.service.js';

describe('Session authentication boundary', () => {
  it('rejects a session at exactly its expiry without changing it', async () => {
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    try {
      const session = {
        id: 'session',
        userId: 'user',
        expiresAt: new Date(now),
        revokedAt: null,
        user: { id: 'user', isEnabled: true },
      };
      const builder = {
        innerJoinAndSelect: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        andWhere: vi.fn().mockReturnThis(),
        getOne: vi.fn().mockResolvedValue(session),
      };
      const repository = {
        createQueryBuilder: () => builder,
      } as unknown as Repository<AuthSessionEntity>;
      await expect(
        new SessionAuthenticationService(repository).authenticate(
          'user',
          'session',
        ),
      ).rejects.toMatchObject({
        response: { statusCode: 401, code: 'UNAUTHORIZED' },
      });
      expect(session.expiresAt.getTime()).toBe(now);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
