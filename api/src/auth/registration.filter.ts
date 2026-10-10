import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

@Catch(HttpException)
export class RegistrationFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const statusCode = exception.getStatus();
    const body =
      statusCode === 429
        ? {
            statusCode,
            code: 'RATE_LIMITED',
            message: 'Too many registration attempts. Please try again later.',
          }
        : exception.getResponse();
    host.switchToHttp().getResponse<Response>().status(statusCode).json(body);
  }
}
