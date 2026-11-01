import { validateEnvironment } from './environment.js';

// Preserve the raw application-only setting while the JWT module validates it.
// The migration CLI continues to use validateEnvironment without requiring JWT.
export function validateApplicationEnvironment(input: Record<string, unknown>) {
  const environment = validateEnvironment(input);
  const lab = input.RELIABILITY_LAB_ENABLED;
  if (lab !== undefined && lab !== 'true' && lab !== 'false')
    throw new Error('RELIABILITY_LAB_ENABLED must be true or false');
  const labEnabled = lab === 'true';
  if (
    labEnabled &&
    (environment.NODE_ENV !== 'development' ||
      !['localhost', '127.0.0.1', '::1', '[::1]'].includes(
        environment.DB_HOST.toLowerCase(),
      ) ||
      environment.DB_NAME !== 'seatsafe_dev')
  )
    throw new Error(
      'Reliability lab requires development mode and local seatsafe_dev',
    );
  const configured = input.AUTH_ALLOWED_ORIGINS;
  if (environment.NODE_ENV === 'production' && configured === undefined)
    throw new Error(
      'AUTH_ALLOWED_ORIGINS requires explicit HTTPS origins in production',
    );
  const values =
    configured === undefined
      ? ['http://localhost:4200', `http://localhost:${environment.PORT}`]
      : typeof configured === 'string'
        ? configured.split(',').map((value) => value.trim())
        : [];
  const origins = values.map((value) => {
    try {
      const url = new URL(value);
      if (
        value !== url.origin ||
        url.username ||
        url.password ||
        !['http:', 'https:'].includes(url.protocol) ||
        (environment.NODE_ENV === 'production' && url.protocol !== 'https:')
      )
        throw new Error();
      return url.origin;
    } catch {
      throw new Error(
        'AUTH_ALLOWED_ORIGINS must contain exact HTTP origins (HTTPS in production)',
      );
    }
  });
  if (!origins.length)
    throw new Error('AUTH_ALLOWED_ORIGINS must not be empty');
  return {
    ...environment,
    JWT_SECRET: input.JWT_SECRET,
    RELIABILITY_LAB_ENABLED: labEnabled,
    AUTH_ALLOWED_ORIGINS: [...new Set(origins)],
  };
}
