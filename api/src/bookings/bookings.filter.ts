import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response, Request } from 'express';
@Catch()
export class BookingsFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof HttpException) {
      if (error.getStatus() === 401)
        response.setHeader('WWW-Authenticate', 'Bearer');
      const body = error.getResponse();
      response.status(error.getStatus()).json(
        typeof body === 'object' &&
          'code' in body &&
          body.code === 'VALIDATION_FAILED'
          ? {
              ...body,
              message:
                http.getRequest<Request>().method === 'GET'
                  ? 'Invalid booking query'
                  : 'Invalid booking request',
            }
          : body,
      );
      return;
    }
    response.status(500).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message:
        http.getRequest<Request>().method === 'GET'
          ? 'Unable to load bookings'
          : 'Unable to reserve seat',
    });
  }
}
