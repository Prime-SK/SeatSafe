import { validateEnvironment } from './environment.js';

// Preserve the raw application-only setting while the JWT module validates it.
// The migration CLI continues to use validateEnvironment without requiring JWT.
export function validateApplicationEnvironment(input: Record<string, unknown>) {
  return { ...validateEnvironment(input), JWT_SECRET: input.JWT_SECRET };
}
