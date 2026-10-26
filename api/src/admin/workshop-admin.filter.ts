import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response, Request } from 'express';

@Catch()
export class WorkshopAdminFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    response.setHeader('Cache-Control', 'no-store');
    if (error instanceof HttpException) {
      const original = error.getResponse();
      // Adapt the shared validation pipe locally; registration/login contracts stay unchanged.
      const body =
        typeof original === 'object' &&
        'code' in original &&
        original.code === 'VALIDATION_FAILED'
          ? { ...original, message: 'Invalid workshop data' }
          : original;
      response.status(error.getStatus()).json(body);
      return;
    }
    response.status(500).json({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message:
        http.getRequest<Request>().method === 'POST'
          ? 'Unable to create workshop'
          : 'Unable to update workshop',
    });
  }
}
