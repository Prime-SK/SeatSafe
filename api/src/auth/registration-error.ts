import { HttpException } from '@nestjs/common';

export class RegistrationError extends HttpException {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(
      { statusCode, code, message, ...(fieldErrors ? { fieldErrors } : {}) },
      statusCode,
    );
  }
}
