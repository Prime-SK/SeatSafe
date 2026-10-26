import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import type { ReadStream, WriteStream } from 'node:tty';
import { AdminSeedError } from './seed-admin-account.js';
import { promptWindowsAdminAccount } from './windows-admin-seed-prompt.js';

export async function promptAdminAccount(
  input: ReadStream = process.stdin,
  output: WriteStream = process.stdout,
) {
  if (!input.isTTY || !output.isTTY)
    throw new AdminSeedError(
      'Administrator seeding requires an interactive terminal.',
    );
  if (
    process.platform === 'win32' &&
    input === process.stdin &&
    output === process.stdout
  )
    return promptWindowsAdminAccount();
  let hidden = false;
  // readline still supports editing/paste, but cannot echo secret input or retain history.
  const muted = new Writable({
    write(chunk, _encoding, done) {
      if (!hidden) output.write(chunk);
      done();
    },
  });
  const terminal = createInterface({
    input,
    output: muted,
    terminal: true,
    historySize: 0,
  });
  let closed = false;
  terminal.once('close', () => {
    closed = true;
  });
  terminal.on('SIGINT', () => terminal.close());
  const question = (label: string, secret = false) =>
    new Promise<string>((resolve, reject) => {
      hidden = secret;
      output.write(label);
      const cancelled = () =>
        reject(
          new AdminSeedError(
            'Administrator seed cancelled. No account was created.',
          ),
        );
      if (closed) {
        cancelled();
        return;
      }
      terminal.once('close', cancelled);
      terminal.question('', (answer) => {
        terminal.off('close', cancelled);
        if (secret) output.write('\n');
        resolve(answer);
      });
    });
  try {
    const displayName = await question('Display name: ');
    const email = await question('Email: ');
    const password = await question('Password (hidden): ', true);
    const confirmation = await question('Confirm password (hidden): ', true);
    if (password !== confirmation)
      throw new AdminSeedError(
        'Passwords do not match. No account was created.',
      );
    return { displayName, email, password };
  } finally {
    terminal.close();
    muted.destroy();
  }
}
