import { PassThrough } from 'node:stream';
import type { ReadStream, WriteStream } from 'node:tty';
import { promptAdminAccount } from './admin-seed-prompt.js';

describe('Private administrator prompt', () => {
  function streams() {
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    let printed = '';
    output.on('data', (chunk) => {
      printed += String(chunk);
    });
    return {
      input,
      output,
      printed: () => printed,
      start: () =>
        promptAdminAccount(
          input as unknown as ReadStream,
          output as unknown as WriteStream,
        ),
    };
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  it('requires a terminal instead of accepting piped credentials', async () => {
    await expect(
      promptAdminAccount(
        new PassThrough() as unknown as ReadStream,
        new PassThrough() as unknown as WriteStream,
      ),
    ).rejects.toThrow('interactive terminal');
  });
  it('hides both password entries while preserving Unicode, spaces and paste', async () => {
    const fixture = streams();
    const pending = fixture.start();
    for (const value of [
      'Admin',
      'admin@example.test',
      '  exact unicode 🔑 password  ',
      '  exact unicode 🔑 password  ',
    ]) {
      fixture.input.write(value + '\r');
      await tick();
    }
    expect(await pending).toEqual({
      displayName: 'Admin',
      email: 'admin@example.test',
      password: '  exact unicode 🔑 password  ',
    });
    expect(fixture.printed()).not.toContain('exact unicode');
    expect(fixture.printed()).not.toContain('🔑');
  });
  it('rejects mismatched confirmation', async () => {
    const fixture = streams();
    const pending = fixture.start();
    const rejected = expect(pending).rejects.toThrow('Passwords do not match');
    for (const value of [
      'Admin',
      'admin@example.test',
      'original long password',
      'different long password',
    ]) {
      fixture.input.write(value + '\r');
      await tick();
    }
    await rejected;
    expect(fixture.printed()).not.toContain('long password');
  });
  it('cancels Ctrl+C without returning credentials', async () => {
    const fixture = streams();
    const pending = fixture.start();
    const rejected = expect(pending).rejects.toThrow('cancelled');
    fixture.input.write('\x03');
    await rejected;
  });
  it('cancels EOF between questions without leaving a hanging prompt', async () => {
    const fixture = streams();
    const pending = fixture.start();
    const rejected = expect(pending).rejects.toThrow('cancelled');
    fixture.input.end('Admin');
    await rejected;
  });
});
