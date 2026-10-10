import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

@Catch(HttpException)
export class LoginFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const statusCode = exception.getStatus();
    const original = exception.getResponse();
    let body = original;
    if (statusCode === 429)
      body = {
        statusCode,
        code: 'RATE_LIMITED',
        message: 'Too many login attempts. Please try again later.',
      };
    else if (
      typeof original === 'object' &&
      'code' in original &&
      original.code === 'VALIDATION_FAILED'
    )
      body = { ...original, message: 'Invalid login data' };
    host.switchToHttp().getResponse<Response>().status(statusCode).json(body);
  }
}
