import { Catch, HttpException, Injectable } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RefreshCookieService } from './refresh-cookie.service.js';

@Injectable()
@Catch(HttpException)
export class SessionCredentialFilter implements ExceptionFilter {
  constructor(private readonly cookies: RefreshCookieService) {}
  catch(exception: HttpException, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const statusCode = exception.getStatus();
    response.setHeader('Cache-Control', 'no-store');
    if (statusCode === 401) this.cookies.clear(response);
    const operation = http.getRequest<Request>().path.endsWith('/logout')
      ? 'logout'
      : 'refresh';
    const body =
      statusCode === 429
        ? {
            statusCode,
            code: 'RATE_LIMITED',
            message: `Too many ${operation} attempts. Please try again later.`,
          }
        : exception.getResponse();
    response.status(statusCode).json(body);
  }
}
