import { createHash } from 'node:crypto';
import type { Request } from 'express';

// Do not decode, unquote or choose between duplicate credentials.
export function readRefreshCredential(request: Request): string | null {
  const values: string[] = [];
  for (let i = 0; i < request.rawHeaders.length; i += 2) {
    if (request.rawHeaders[i].toLowerCase() !== 'cookie') continue;
    for (const pair of request.rawHeaders[i + 1].split(';')) {
      const separator = pair.indexOf('=');
      const name = (separator < 0 ? pair : pair.slice(0, separator)).trim();
      if (name === 'seatsafe_refresh')
        values.push(separator < 0 ? '' : pair.slice(separator + 1).trim());
    }
  }
  return values.length === 1 && /^[A-Za-z0-9_-]{43}$/.test(values[0])
    ? values[0]
    : null;
}

export function refreshDigest(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
