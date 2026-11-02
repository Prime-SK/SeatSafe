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
  question: vi.fn(),
  close: vi.fn(),
}));
vi.mock('./data-source.js', () => ({ default: fixture.database }));
vi.mock('../config/environment.js', () => ({
  validateEnvironment: fixture.environment,
}));
vi.mock('./admin-seed-prompt.js', () => ({
  promptAdminAccount: fixture.prompt,
}));
vi.mock('./seed-admin-account.js', () => ({
  AdminSeedError: class extends Error {},
  seedAdminAccount: fixture.seed,
}));
vi.mock('node:readline/promises', () => ({
  createInterface: () => ({ question: fixture.question, close: fixture.close }),
}));
describe('Private production administrator command', () => {
  let argv: string[],
    exitCode: typeof process.exitCode,
    inputDescriptor: PropertyDescriptor | undefined,
    outputDescriptor: PropertyDescriptor | undefined;
  let log: ReturnType<typeof vi.spyOn>, error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    argv = process.argv;
    exitCode = process.exitCode;
    inputDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    outputDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });
    Object.defineProperty(process.stdout, 'isTTY', {
      value: true,
      configurable: true,
    });
    process.argv = ['node', 'seed-admin-production.js'];
    process.exitCode = 0;
    fixture.database.isInitialized = false;
    fixture.database.initialize.mockImplementation(async () => {
      fixture.database.isInitialized = true;
    });
    fixture.database.destroy.mockImplementation(async () => {
      fixture.database.isInitialized = false;
    });
    fixture.database.showMigrations.mockResolvedValue(false);
    fixture.environment.mockReturnValue({
      NODE_ENV: 'production',
      DB_SSL: true,
    });
    fixture.question.mockResolvedValue('CREATE ADMIN');
    fixture.seed.mockResolvedValue('inserted');
    fixture.prompt.mockResolvedValue({
      displayName: 'Synthetic admin',
      email: 'admin@example.test',
      password: 'public password fixture',
    });
    log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    if (inputDescriptor)
      Object.defineProperty(process.stdin, 'isTTY', inputDescriptor);
    else Reflect.deleteProperty(process.stdin, 'isTTY');
    if (outputDescriptor)
      Object.defineProperty(process.stdout, 'isTTY', outputDescriptor);
    else Reflect.deleteProperty(process.stdout, 'isTTY');
    vi.restoreAllMocks();
  });
  const run = () => import('./seed-admin-production.js');
  it.each(['inserted', 'skipped'])(
    'confirms production action then reports %s and clears password',
    async (result) => {
      fixture.seed.mockResolvedValue(result);
      const input = await fixture.prompt();
      fixture.prompt.mockClear();
      await run();
      expect(fixture.question).toHaveBeenCalledOnce();
      expect(log).toHaveBeenCalledExactlyOnceWith(
        `Production administrator bootstrap: ${result}.`,
      );
      expect(input.password).toBe('');
      expect(fixture.database.destroy).toHaveBeenCalledOnce();
    },
  );
  it('rejects noninteractive execution without connecting', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    });
    await run();
    expect(fixture.database.initialize).not.toHaveBeenCalled();
    expect(fixture.question).not.toHaveBeenCalled();
  });
  it('cancels before connection and credentials', async () => {
    fixture.question.mockResolvedValue('no');
    await run();
    expect(fixture.database.initialize).not.toHaveBeenCalled();
    expect(fixture.prompt).not.toHaveBeenCalled();
  });
  it('requires migrated database before prompting for credentials', async () => {
    fixture.database.showMigrations.mockResolvedValue(true);
    await run();
    expect(fixture.prompt).not.toHaveBeenCalled();
    expect(fixture.seed).not.toHaveBeenCalled();
    expect(fixture.database.destroy).toHaveBeenCalledOnce();
  });
  it('rejects development mode without changing its existing seed policy', async () => {
    fixture.environment.mockReturnValue({
      NODE_ENV: 'development',
      DB_SSL: true,
    });
    await run();
    expect(fixture.database.initialize).not.toHaveBeenCalled();
  });
  it('rejects arguments including attempted password arguments', async () => {
    process.argv.push('--password=fixture');
    await run();
    expect(fixture.prompt).not.toHaveBeenCalled();
    expect(fixture.database.initialize).not.toHaveBeenCalled();
  });
  it('sanitizes failed writes and clears the password', async () => {
    fixture.seed.mockRejectedValue(Error('PRIVATE connection and password'));
    const input = await fixture.prompt();
    fixture.prompt.mockClear();
    await run();
    expect(input.password).toBe('');
    expect(JSON.stringify(error.mock.calls)).not.toContain('PRIVATE');
    expect(process.exitCode).toBe(1);
    expect(fixture.database.destroy).toHaveBeenCalledOnce();
  });
});
