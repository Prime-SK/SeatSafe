import { bookingFingerprint, readIdempotencyKey } from './idempotency-key.js';

describe('Reservation request keys and fingerprints', () => {
  it.each([16, 128])(
    'accepts a case-sensitive %i-character ASCII key',
    (length) => {
      const key = 'Aa0_-'.repeat(26).slice(0, length);
      expect(readIdempotencyKey(['idEMPotency-KEY', key])).toBe(key);
    },
  );
  it.each(
    [
      [],
      ['Idempotency-Key', ''],
      ['Idempotency-Key', 'x'.repeat(15)],
      ['Idempotency-Key', 'x'.repeat(129)],
      ['Idempotency-Key', 'valid-key-000001,valid-key-000002'],
      ['Idempotency-Key', ' valid-key-000001'],
      ['Idempotency-Key', 'invalid key-000001'],
      ['Idempotency-Key', 'සිංහල-key-000001'],
      [
        'Idempotency-Key',
        'valid-key-000001',
        'idempotency-key',
        'valid-key-000001',
      ],
    ].map((headers) => ({ headers })),
  )('rejects invalid or ambiguous headers %j', ({ headers }) => {
    expect(() => readIdempotencyKey(headers)).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
      }),
    );
  });
  it('fingerprints the case-sensitive opaque workshop ID deterministically', () => {
    expect(bookingFingerprint('legacy/id')).toMatch(/^[a-f0-9]{64}$/);
    expect(bookingFingerprint('legacy/id')).toBe(
      bookingFingerprint('legacy/id'),
    );
    expect(bookingFingerprint('Legacy/id')).not.toBe(
      bookingFingerprint('legacy/id'),
    );
    expect(bookingFingerprint('another')).not.toBe(
      bookingFingerprint('legacy/id'),
    );
  });
});
