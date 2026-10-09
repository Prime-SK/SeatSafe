export type NodeEnvironment = 'development' | 'test' | 'production';

export interface Environment {
  NODE_ENV: NodeEnvironment;
  PORT: number;
  DB_HOST: string;
  DB_PORT: number;
  DB_NAME: string;
  DB_USER: string;
  DB_PASSWORD: string;
}

export function validateEnvironment(
  input: Record<string, unknown>,
): Environment {
  const errors: string[] = [];

  function text(key: string, fallback?: string, preserve = false): string {
    const value = input[key] === undefined ? fallback : input[key];
    if (typeof value !== 'string' || value.trim().length === 0) {
      errors.push(`${key} must be a nonblank string`);
      return '';
    }
    return preserve ? value : value.trim();
  }

  function port(key: string, fallback: number): number {
    const value = input[key] === undefined ? fallback : input[key];
    const candidate = typeof value === 'string' ? value.trim() : value;
    const number =
      typeof candidate === 'number'
        ? candidate
        : typeof candidate === 'string' && /^\d+$/.test(candidate)
          ? Number(candidate)
          : NaN;
    if (!Number.isInteger(number) || number < 1 || number > 65535) {
      errors.push(`${key} must be an integer from 1 to 65535`);
    }
    return number;
  }

  const nodeEnvironment = text('NODE_ENV', 'development');
  if (!['development', 'test', 'production'].includes(nodeEnvironment)) {
    errors.push('NODE_ENV must be development, test, or production');
  }

  const environment: Environment = {
    NODE_ENV: nodeEnvironment as NodeEnvironment,
    PORT: port('PORT', 3000),
    DB_HOST: text('DB_HOST', 'localhost'),
    DB_PORT: port('DB_PORT', 5432),
    DB_NAME: text('DB_NAME'),
    DB_USER: text('DB_USER'),
    DB_PASSWORD: text('DB_PASSWORD', undefined, true),
  };

  if (errors.length > 0) {
    // Report keys and requirements, never submitted values or credentials.
    throw new Error(`Invalid environment configuration:\n${errors.join('\n')}`);
  }
  return environment;
}
