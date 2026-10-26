import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { vi } from 'vitest';
import { promptWindowsAdminAccount } from './windows-admin-seed-prompt.js';

const fixture = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: fixture.spawn }));

describe('Windows secure administrator input pipe', () => {
  let child: EventEmitter & {
    stdout: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      kill: vi.fn(),
    });
    fixture.spawn.mockReset().mockReturnValue(child);
  });
  it('accepts only the result through a private pipe, with no password arguments', async () => {
    const input = {
      displayName: 'Admin',
      email: 'admin@example.test',
      password: '  unchanged 🔑 fixture password  ',
    };
    const pending = promptWindowsAdminAccount();
    child.stdout.write('Host formatting\n' + JSON.stringify(input) + '\n');
    child.emit('close', 0);
    expect(await pending).toEqual(input);
    expect(fixture.spawn).toHaveBeenCalledWith(
      'pwsh',
      ['-NoProfile', '-File', expect.stringContaining('seed-admin-prompt.ps1')],
      { stdio: ['inherit', 'pipe', 'inherit'], windowsHide: true },
    );
    expect(JSON.stringify(fixture.spawn.mock.calls)).not.toContain(
      input.password,
    );
  });
  it.each([2, 3, null])(
    'handles failed/cancelled prompt exit %s without returning data',
    async (code) => {
      const pending = promptWindowsAdminAccount();
      child.emit('close', code);
      await expect(pending).rejects.toThrow(
        code === 2 ? 'Passwords do not match' : 'cancelled',
      );
    },
  );
  it.each([
    'private malformed result',
    '{}',
    '{"displayName":"Admin","email":"admin@example.test","password":123}',
  ])('sanitizes invalid child output %s', async (value) => {
    const pending = promptWindowsAdminAccount();
    child.stdout.write(value);
    child.emit('close', 0);
    await expect(pending).rejects.toThrow(
      'Unable to read administrator details. No account was created.',
    );
  });
  it('sanitizes missing PowerShell errors', async () => {
    const pending = promptWindowsAdminAccount();
    child.emit('error', new Error('private process details'));
    await expect(pending).rejects.toThrow(
      'Use PowerShell 7 in an interactive terminal',
    );
    child.emit('close', -1);
  });
  it('bounds captured output and refuses an interrupted helper', async () => {
    const pending = promptWindowsAdminAccount();
    child.stdout.write('x'.repeat(65537));
    child.emit('close', null);
    await expect(pending).rejects.toThrow('cancelled');
    expect(child.kill).toHaveBeenCalledTimes(1);
  });
});
