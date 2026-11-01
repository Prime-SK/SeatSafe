import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { RegistrationError } from '../auth/registration-error.js';

export function readIdempotencyKey(rawHeaders: string[]): string {
  const values: string[] = [];
  for (let index = 0; index < rawHeaders.length; index += 2) {
    if (rawHeaders[index].toLowerCase() === 'idempotency-key')
      values.push(rawHeaders[index + 1]);
  }
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{16,128}$/.test(values[0])) {
    throw new RegistrationError(
      400,
      'VALIDATION_FAILED',
      'Invalid booking request',
      {
        'Idempotency-Key': [
          'Supply one request key of 16–128 letters, digits, hyphens or underscores',
        ],
      },
    );
  }
  return values[0];
}

export const IdempotencyKey = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    readIdempotencyKey(context.switchToHttp().getRequest<Request>().rawHeaders),
);

export function bookingFingerprint(workshopId: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        'seatsafe-reservation-v1',
        'POST',
        '/api/workshops/:id/bookings',
        workshopId,
        {},
      ]),
    )
    .digest('hex');
}
