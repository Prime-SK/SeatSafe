import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AdminSeedError } from './seed-admin-account.js';

export function promptWindowsAdminAccount(): Promise<{
  displayName: string;
  email: string;
  password: string;
}> {
  return new Promise((resolve, reject) => {
    // Existing PowerShell 7 handles Windows console input without Node raw-mode cleanup.
    // Only the JSON result uses the private stdout pipe; prompts use inherited stderr.
    const child = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        fileURLToPath(
          new URL('../../../scripts/seed-admin-prompt.ps1', import.meta.url),
        ),
      ],
      {
        stdio: ['inherit', 'pipe', 'inherit'],
        windowsHide: true,
      },
    );
    let captured = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      captured += chunk;
      if (captured.length > 65536) {
        captured = '';
        child.kill();
      }
    });
    child.on('error', () =>
      reject(
        new AdminSeedError(
          'Unable to open the secure prompt. Use PowerShell 7 in an interactive terminal.',
        ),
      ),
    );
    child.on('close', (code) => {
      try {
        if (code === 2)
          throw new AdminSeedError(
            'Passwords do not match. No account was created.',
          );
        if (code !== 0)
          throw new AdminSeedError(
            'Administrator seed cancelled. No account was created.',
          );
        // Read-Host can emit host formatting before the single-line JSON result.
        const value: unknown = JSON.parse(
          captured.trim().split(/\r?\n/u).at(-1) ?? '',
        );
        if (
          !value ||
          typeof value !== 'object' ||
          !('displayName' in value) ||
          !('email' in value) ||
          !('password' in value) ||
          typeof value.displayName !== 'string' ||
          typeof value.email !== 'string' ||
          typeof value.password !== 'string'
        )
          throw new Error('Invalid prompt result');
        resolve({
          displayName: value.displayName,
          email: value.email,
          password: value.password,
        });
      } catch (error) {
        reject(
          error instanceof AdminSeedError
            ? error
            : new AdminSeedError(
                'Unable to read administrator details. No account was created.',
              ),
        );
      } finally {
        captured = '';
      }
    });
  });
}
