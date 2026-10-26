import { vi } from 'vitest';
// Database tests use a public signing fixture, never the local JWT secret.
vi.stubEnv('JWT_SECRET', 'public-database-test-signing-secret-32-bytes');

vi.stubEnv(
  'AUTH_ALLOWED_ORIGINS',
  'http://localhost:3000,http://localhost:4200',
);
