import { spawn } from 'node:child_process';
// The normal application validates the loaded mode/database before binding loopback.
const child = spawn(process.execPath, ['dist/main.js'], {
  env: { ...process.env, RELIABILITY_LAB_ENABLED: 'true' },
  stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
  windowsHide: true,
});
child.on('error', () => {
  console.error('Unable to start reliability lab');
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    // Windows kill(signal) can terminate immediately, before Nest's cleanup hooks.
    if (child.connected)
      child.send('seatsafe-lab-shutdown', (error) => {
        if (error) process.exitCode = 1;
      });
  });
