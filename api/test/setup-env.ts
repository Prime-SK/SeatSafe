import { vi } from 'vitest';

// Public fixture values; no local .env or real database is used by HTTP tests.
vi.stubEnv('NODE_ENV', 'test');
vi.stubEnv('PORT', '3000');
vi.stubEnv('DB_HOST', 'localhost');
vi.stubEnv('DB_PORT', '5432');
vi.stubEnv('DB_NAME', 'seatsafe_http_test');
vi.stubEnv('DB_USER', 'seatsafe_http_test');
vi.stubEnv('DB_PASSWORD', 'public-test-fixture');
