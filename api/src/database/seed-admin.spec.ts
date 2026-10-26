import { vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  database: {
    isInitialized: false,
    initialize: vi.fn(),
    showMigrations: vi.fn(),
    destroy: vi.fn(),
  },
  environment: vi.fn(),
  prompt: vi.fn(),
  seed: vi.fn(),
}));
vi.mock('./data-source.js', () => ({ default: fixture.database }));
vi.mock('../config/environment.js', () => ({
  validateEnvironment: fixture.environment,
}));
vi.mock('./admin-seed-prompt.js', () => ({
  promptAdminAccount: fixture.prompt,
}));
vi.mock('./seed-admin-account.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./seed-admin-account.js')>()),
  seedAdminAccount: fixture.seed,
}));

describe('Administrator seed command lifecycle', () => {
  let argv: string[];
  let exitCode: typeof process.exitCode;
  let log: ReturnType<typeof vi.spyOn>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    argv = process.argv;
    exitCode = process.exitCode;
    process.argv = ['node', 'seed-admin.js'];
    process.exitCode = 0;
    fixture.database.isInitialized = false;
    fixture.environment.mockReturnValue({ NODE_ENV: 'development' });
    fixture.database.initialize.mockImplementation(async () => {
      fixture.database.isInitialized = true;
    });
    fixture.database.destroy.mockImplementation(async () => {
      fixture.database.isInitialized = false;
    });
    fixture.database.showMigrations.mockResolvedValue(false);
    fixture.prompt.mockResolvedValue({
      displayName: 'Admin',
      email: 'admin@example.test',
      password: 'private test fixture password',
    });
    fixture.seed.mockResolvedValue('inserted');
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    vi.restoreAllMocks();
  });
  const run = () => import('./seed-admin.js');
  it('prints only the result, clears the local password and closes the connection', async () => {
    const input = await fixture.prompt();
    fixture.prompt.mockClear();
    await run();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      'Administrator seed: inserted.',
    );
    expect(input.password).toBe('');
    expect(fixture.database.destroy).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });
  it('reports a skipped existing administrator safely', async () => {
    fixture.seed.mockResolvedValue('skipped');
    await run();
    expect(log).toHaveBeenCalledWith('Administrator seed: skipped.');
  });
  it.each(['production', 'test'])(
    'rejects %s before opening a connection',
    async (mode) => {
      fixture.environment.mockReturnValue({ NODE_ENV: mode });
      await run();
      expect(process.exitCode).toBe(1);
      expect(fixture.database.initialize).not.toHaveBeenCalled();
      expect(fixture.prompt).not.toHaveBeenCalled();
    },
  );
  it('rejects arguments before connection or prompting', async () => {
    process.argv.push('not-accepted');
    await run();
    expect(fixture.database.initialize).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      'Administrator seed accepts no command-line arguments.',
    );
  });
  it('requires migrations before asking for credentials', async () => {
    fixture.database.showMigrations.mockResolvedValue(true);
    await run();
    expect(fixture.prompt).not.toHaveBeenCalled();
    expect(fixture.seed).not.toHaveBeenCalled();
    expect(fixture.database.destroy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
  it('never seeds after cancellation', async () => {
    const { AdminSeedError } = await import('./seed-admin-account.js');
    fixture.prompt.mockRejectedValue(
      new AdminSeedError(
        'Administrator seed cancelled. No account was created.',
      ),
    );
    await run();
    expect(fixture.seed).not.toHaveBeenCalled();
    expect(fixture.database.destroy).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(1);
  });
  it.each(['initialize', 'seed', 'destroy'] as const)(
    'sanitizes %s failures',
    async (stage) => {
      const failure = new Error('private connection details and password');
      if (stage === 'seed') fixture.seed.mockRejectedValue(failure);
      else fixture.database[stage].mockRejectedValue(failure);
      await run();
      expect(process.exitCode).toBe(1);
      expect(JSON.stringify(error.mock.calls)).not.toContain(failure.message);
      expect(log).not.toHaveBeenCalledWith(expect.stringContaining('private'));
    },
  );
});
