import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { readRefreshCredential, refreshDigest } from './refresh-credential.js';
import { RefreshCookieService } from './refresh-cookie.service.js';
import { createHash } from 'node:crypto';

describe('Refresh credential extraction', () => {
  const raw = 'A'.repeat(43);
  const read = (headers: string[]) =>
    readRefreshCredential({ rawHeaders: headers } as Request);
  it('extracts one named credential across raw headers and ignores unrelated cookies', () => {
    expect(
      read([
        'Cookie',
        'theme=green',
        'cOoKiE',
        `other=x; seatsafe_refresh=${raw}; mode=light`,
      ]),
    ).toBe(raw);
    expect(refreshDigest(raw)).toBe(
      createHash('sha256').update(raw).digest('hex'),
    );
  });
  it.each([
    '',
    'x',
    'A'.repeat(42),
    'A'.repeat(44),
    'A'.repeat(42) + '+',
    'A'.repeat(42) + '/',
    'A'.repeat(42) + '=',
    '"' + raw + '"',
    '%41'.repeat(43),
  ])('rejects malformed credential %s', (value) => {
    expect(read(['Cookie', `seatsafe_refresh=${value}`])).toBeNull();
  });
  it.each(
    [
      [],
      ['Cookie', 'theme=green'],
      ['Cookie', 'seatsafe_refresh'],
      ['Cookie', `seatsafe_refresh=${raw}; seatsafe_refresh=${raw}`],
      [
        'Cookie',
        `seatsafe_refresh=${raw}`,
        'Cookie',
        `seatsafe_refresh=${raw}`,
      ],
    ].map((headers) => ({ headers })),
  )('rejects missing or ambiguous identity %j', ({ headers }) =>
    expect(read(headers)).toBeNull(),
  );
  it.each(['development', 'production'])(
    'clears the matching cookie scope with no replacement lifetime in %s',
    (environment) => {
      const clearCookie = vi.fn();
      new RefreshCookieService(
        new ConfigService({ NODE_ENV: environment }),
      ).clear({ clearCookie } as unknown as Response);
      expect(clearCookie).toHaveBeenCalledWith('seatsafe_refresh', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/auth',
        secure: environment === 'production',
      });
    },
  );
});
