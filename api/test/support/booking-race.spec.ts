import {
  assertLocalRaceTarget,
  raceTable,
  ReadBarrier,
  settleAttempts,
} from './booking-race.js';

describe('Race experiment safety and coordination', () => {
  const local = {
    type: 'postgres',
    host: 'localhost',
    database: 'seatsafe_dev',
  };
  afterEach(() => vi.useRealTimers());
  it.each(['localhost', '127.0.0.1', '::1', '[::1]'])(
    'accepts explicit local host %s',
    (host) => {
      expect(() =>
        assertLocalRaceTarget({ ...local, host }, 'test'),
      ).not.toThrow();
    },
  );
  it.each([
    { environment: 'production', options: local },
    { environment: undefined, options: local },
    {
      environment: 'test',
      options: { ...local, host: 'database.example.test' },
    },
    {
      environment: 'test',
      options: { ...local, host: 'localhost.example.test' },
    },
    { environment: 'test', options: { ...local, database: 'other_database' } },
    {
      environment: 'test',
      options: { ...local, url: 'postgres://example.test' },
    },
    { environment: 'test', options: { ...local, replication: {} } },
  ])(
    'refuses unsafe database targets before connecting: $environment',
    ({ options, environment }) => {
      expect(() => assertLocalRaceTarget(options, environment)).toThrow(
        'requires local',
      );
    },
  );
  it('only permits a generated disposable schema identifier', () => {
    expect(raceTable('seatsafe_test_' + 'a'.repeat(32))).toContain('workshops');
    for (const schema of [
      'public',
      'seatsafe_test_',
      'seatsafe_test_";DROP SCHEMA public',
    ])
      expect(() => raceTable(schema)).toThrow();
  });
  it('releases neither participant until both reads arrive', async () => {
    const barrier = new ReadBarrier();
    let released = false;
    const first = barrier.arrive().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(false);
    await barrier.arrive();
    await first;
    expect(released).toBe(true);
  });
  it('bounds missing-participant waits without timing sleeps', async () => {
    vi.useFakeTimers();
    const barrier = new ReadBarrier(2, 100);
    const assertion = expect(barrier.arrive()).rejects.toThrow(
      'barrier stopped',
    );
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });
  it('settles both attempts when one fails before reaching the barrier', async () => {
    const barrier = new ReadBarrier();
    const results = await settleAttempts(
      [
        async () => {
          throw new Error('Injected pre-read failure');
        },
        async () => {
          await barrier.arrive();
          return 'accepted';
        },
      ],
      barrier,
    );
    expect(results.map((result) => result.status)).toEqual([
      'rejected',
      'rejected',
    ]);
  });
});
